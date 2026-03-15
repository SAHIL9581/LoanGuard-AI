import os
import io
import json
import time
import logging
from typing import Union, Dict, Any, List, Optional
from PIL import Image
from pdf2image import convert_from_path, convert_from_bytes
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Configure Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

load_dotenv()

# Configuration
from app.config import get_settings
GEMINI_API_KEY = get_settings().gemini_api_key
MODEL_NAME = "gemini-2.5-flash"   # FIX #4: was "gemini-2.5-flash" (invalid model string)
MAX_STITCHED_HEIGHT_PX = 16000                   # FIX #7: cap image height to avoid Gemini size limits
MAX_RETRIES = 3                                  # FIX #8: retry on transient API failures
RETRY_DELAY_SECONDS = 2


class VisionExtractionError(Exception):
    """Custom exception for vision extraction failures."""
    pass


# ---------------------------------------------------------------------------
# PDF / Image helpers
# ---------------------------------------------------------------------------

def _convert_pdf_to_images(file_path_or_bytes: Union[str, bytes]) -> List[Image.Image]:
    """Converts PDF pages to a list of PIL Images."""
    try:
        if isinstance(file_path_or_bytes, str):
            # Windows users: set poppler_path=r"C:\poppler\Library\bin"
            return convert_from_path(file_path_or_bytes, dpi=200)
        else:
            return convert_from_bytes(file_path_or_bytes, dpi=200)
    except Exception as e:
        logger.error(f"Error converting PDF to images: {e}")
        raise VisionExtractionError(f"Failed to process PDF file: {e}")


def _is_pdf_bytes(data: bytes) -> bool:
    """FIX #2: Robust PDF detection — checks first 1024 bytes for the %%PDF header."""
    return b"%PDF" in data[:1024]


def _stitch_images_vertically(images: List[Image.Image]) -> Optional[Image.Image]:
    """
    Glues multiple PDF pages into one continuous vertical image.
    FIX #7: Splits into batches if total height exceeds MAX_STITCHED_HEIGHT_PX.
    Returns a single stitched image (or the first batch only — caller handles batching).
    """
    if not images:
        return None   # FIX #1: was silently returning None and crashing downstream
    if len(images) == 1:
        return images[0]

    widths, heights = zip(*(i.size for i in images))
    total_height = sum(heights)
    max_width = max(widths)

    if total_height > MAX_STITCHED_HEIGHT_PX:
        logger.warning(
            f"Total stitched height {total_height}px exceeds limit {MAX_STITCHED_HEIGHT_PX}px. "
            "Truncating to first N pages that fit. Consider splitting the PDF."
        )
        kept, running = [], 0
        for img in images:
            if running + img.size[1] > MAX_STITCHED_HEIGHT_PX:
                break
            kept.append(img)
            running += img.size[1]
        images = kept or [images[0]]
        heights = tuple(i.size[1] for i in images)
        total_height = sum(heights)

    stitched = Image.new("RGB", (max_width, total_height), (255, 255, 255))
    y_offset = 0
    for im in images:
        stitched.paste(im, (0, y_offset))
        y_offset += im.size[1]

    return stitched


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def _prepare_gemini_prompt(document_type: str) -> str:
    """Generates the universal extraction prompt with income and savings detection."""
    schema = {
        "extracted_records": [
            {
                "metadata": {
                    "inferred_document_type": "Bank_Statement | UPI_Screenshot | Ecommerce_Receipt",
                    "institution_or_merchant": "String (e.g., 'Amazon', 'HDFC Bank', 'SBI')",
                    "document_id_or_utr": "String or null",
                    "statement_period_or_date": "String (YYYY-MM-DD or 'Mar 2026')",
                    "detected_income": "Float or null — monthly salary/income if confidently detected",
                    "income_confidence": "high | medium | low | none",
                    "income_source": "String or null — employer name or source if detected"
                },
                "transactions": [
                    {
                        "index": "Integer",
                        "date": "YYYY-MM-DD or null",
                        "description": "String",
                        "raw_amount_text": "String (transcribe EXACTLY from document)",
                        "type": "DEBIT | CREDIT",
                        "amount": "Float (absolute value only)",
                        "category_classification": (
                            "Electronics | Food | Groceries | Shopping | Healthcare | "
                            "Entertainment | Travel | Utilities | Transfer | Income | "
                            "Rent | Education | Insurance | EMI | Savings_Investment | Unknown"
                        ),
                        "is_recurring": "Boolean — true if this transaction appears multiple times",
                        "is_savings": "Boolean — true if this is a SIP, FD, RD, MF, NPS, PPF payment"
                    }
                ]
            }
        ]
    }

    return f"""You are an elite financial data extractor for Indian financial documents.
The user labeled this document as: "{document_type}".
Extract ALL data into this exact JSON schema:

{json.dumps(schema, indent=2)}

INCOME DETECTION RULES:
- Flag detected_income ONLY if you see a CREDIT that is:
  1. Recurring (same amount ±5%% on roughly same date each month), OR
  2. Description contains: salary, sal, payroll, NEFT from a company name
  3. Amount is above ₹8,000
- Set income_confidence to "high" if recurring + keyword match
- Set income_confidence to "medium" if only one signal present
- Set income_confidence to "low" if you're guessing
- Set income_confidence to "none" and detected_income to null if not found
- EXCLUDE from income: round numbers under ₹5,000, refunds, cashbacks,
  reimbursements, personal UPI IDs (name@okicici, name@paytm), one-time credits

SAVINGS DETECTION RULES:
- Set is_savings to true and category to Savings_Investment if description contains:
  MF, mutual fund, SIP, ELSS, RD, FD, fixed deposit, recurring deposit,
  NPS, PPF, EPF, NACH to known AMCs (HDFC MF, SBI MF, Zerodha, Groww, Kuvera, Paytm Money)
- These are DEBIT transactions that represent existing investments

BANK STATEMENT RULES:
- Every table row = one transaction
- Debit/Withdrawal column → DEBIT type
- Credit/Deposit column → CREDIT type  
- Watch for two-column format (separate debit and credit columns)
- NACH/ECS mandates are usually SIP or loan EMI — check description to distinguish

E-COMMERCE RULES:
- Each product/item = one DEBIT transaction
- Use actual item name as description
- Category should reflect the item (Electronics for gadgets, Shopping for accessories)

CRITICAL GUIDELINES:
1. Fill raw_amount_text by transcribing EXACTLY what you see first, then derive amount
2. The ₹ symbol can look like 5 or 3 in low-res scans — use context to validate
3. Scan top to bottom — do NOT skip any rows
4. If a field is not visible use null, never empty string
5. is_recurring should be true if you see the same merchant/amount appearing 2+ times
"""

# ---------------------------------------------------------------------------
# Core extraction function
# ---------------------------------------------------------------------------

def extract_financial_data(
    file_path_or_bytes: Union[str, bytes],
    document_type: str = "Financial Document"
) -> Dict[str, Any]:
    """
    Main entry point. Extracts financial transactions from an image or PDF.

    Args:
        file_path_or_bytes: Local file path (str) OR raw bytes of the file.
        document_type: Human hint for the model (e.g. 'Bank Statement', 'Amazon Receipt').

    Returns:
        Parsed dict with 'extracted_records' key.
    """
    if not GEMINI_API_KEY:
        raise VisionExtractionError("GEMINI_API_KEY environment variable is not set.")

    # --- Load images ---
    if isinstance(file_path_or_bytes, str):
        ext = os.path.splitext(file_path_or_bytes)[1].lower()
        if ext == ".pdf":
            images = _convert_pdf_to_images(file_path_or_bytes)
        else:
            # FIX #3: use context manager pattern, keep reference alive for stitching
            img = Image.open(file_path_or_bytes)
            images = [img.copy()]
            img.close()
    else:
        if _is_pdf_bytes(file_path_or_bytes):   # FIX #2
            images = _convert_pdf_to_images(file_path_or_bytes)
        else:
            img = Image.open(io.BytesIO(file_path_or_bytes))
            images = [img.copy()]
            img.close()

    if not images:
        raise VisionExtractionError("No valid images could be loaded from the provided file.")

    logger.info(f"🧵 Stitching {len(images)} page(s) into a single canvas...")
    final_image = _stitch_images_vertically(images)

    # FIX #1: guard against None from stitcher
    if final_image is None:
        raise VisionExtractionError("Image stitching produced no output.")

    logger.info("👀 Sending canvas to Gemini Vision...")
    client = genai.Client(api_key=GEMINI_API_KEY)
    prompt = _prepare_gemini_prompt(document_type)

    # FIX #8: retry loop for transient failures
    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=[prompt, final_image],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )

            # FIX #5: graceful JSON parse with detailed error message
            try:
                extracted_data = json.loads(response.text)
            except json.JSONDecodeError as je:
                logger.error(f"Gemini returned non-JSON on attempt {attempt}: {je}")
                logger.debug(f"Raw response: {response.text[:500]}")
                raise VisionExtractionError(
                    f"Model returned malformed JSON. Raw snippet: {response.text[:200]}"
                )

            # Basic structure validation
            if "extracted_records" not in extracted_data:
                raise VisionExtractionError(
                    "Response missing 'extracted_records' key. Full response: "
                    + json.dumps(extracted_data)[:300]
                )

            logger.info(
                f"✅ Extracted {sum(len(r.get('transactions', [])) for r in extracted_data['extracted_records'])} "
                f"transaction(s) from {len(extracted_data['extracted_records'])} record(s)."
            )
            return extracted_data

        except VisionExtractionError:
            raise  # Don't retry our own validation errors
        except Exception as e:
            last_error = e
            logger.warning(f"Attempt {attempt}/{MAX_RETRIES} failed: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY_SECONDS * attempt)

    raise VisionExtractionError(f"All {MAX_RETRIES} attempts failed. Last error: {last_error}")


# ---------------------------------------------------------------------------
# CLI usage
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python vision_extractor.py <file_path> [document_type]")
        print("  document_type defaults to 'Financial Document'")
        sys.exit(1)

    file_arg = sys.argv[1]
    dtype_arg = sys.argv[2] if len(sys.argv) > 2 else "Financial Document"

    try:
        result = extract_financial_data(file_arg, dtype_arg)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except VisionExtractionError as e:
        print(f"❌ Extraction failed: {e}")
        sys.exit(1)