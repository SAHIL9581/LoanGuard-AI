import pdfplumber
import fitz  # PyMuPDF
import re
import json
import httpx
from typing import Optional
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from app.config import get_settings
from app.models.schemas import LoanExtraction
from app.services.llm_utils import parse_json_payload

settings = get_settings()

# ── PDF Text Extraction ────────────────────────────────────────────────────────

def extract_text_pdfplumber(file_bytes: bytes) -> str:
    try:
        import io
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            pages = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages.append(text)
            return "\n".join(pages)
    except Exception as e:
        logger.warning(f"pdfplumber failed: {e}, trying PyMuPDF fallback")
        return ""


def extract_text_pymupdf(file_bytes: bytes) -> str:
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages = []
        for page in doc:
            pages.append(page.get_text())
        doc.close()
        return "\n".join(pages)
    except Exception as e:
        logger.error(f"PyMuPDF also failed: {e}")
        return ""


def extract_text_from_pdf(file_bytes: bytes) -> str:
    text = extract_text_pdfplumber(file_bytes)
    if len(text.strip()) < 100:
        logger.info("Switching to PyMuPDF fallback for better extraction")
        text = extract_text_pymupdf(file_bytes)
    return text

# ── Text Preprocessing ─────────────────────────────────────────────────────────

def normalize_indian_numbers(text: str) -> str:
    """
    Convert Indian lakh/crore number format to plain integers BEFORE
    sending to the LLM so it doesn't misparse "5,00,000" as 5.0 or 500.
    Also replaces Rs. and rupee symbols with plain ASCII INR for model context.
    """
    text = re.sub(r'₹\s*', 'INR ', text)
    text = re.sub(r'Rs\.?\s*', 'INR ', text)

    def strip_commas(m):
        return m.group(0).replace(',', '')

    text = re.sub(r'\b\d{1,3}(?:,\d{2,3})+\b', strip_commas, text)
    return text


def preprocess_text(raw_text: str) -> str:
    """
    Order matters:
      1. Normalize ₹ → INR and Indian numbers FIRST (before stripping non-ASCII)
      2. Collapse excess whitespace
      3. Strip remaining non-ASCII
      4. Collapse double-spaces created by replacements
    """
    text = normalize_indian_numbers(raw_text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]{2,}', ' ', text)
    text = re.sub(r'[^\x00-\x7F]+', ' ', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()

# ── Regex Fallback Extraction ──────────────────────────────────────────────────

def regex_extract_fallback(text: str) -> dict:
    """
    Regex-based extraction that always runs alongside the LLM.
    Fills any fields the LLM returned as 0 / empty.
    All boolean fields return actual Python bools to match LoanExtraction schema.
    """
    result = {}

    # ── Numeric fields ─────────────────────────────────────────────────────────

    m = re.search(
        r'(?:principal|loan amount|sanctioned|disbursed)[^\d]{0,40}?(?:INR\s*)?(\d{5,9})',
        text, re.IGNORECASE
    )
    if m:
        result['principal'] = float(m.group(1))

    m = re.search(
        r'(\d{1,2}(?:\.\d{1,4})?)\s*%\s*(?:per\s+annum|p\.?a\.)',
        text, re.IGNORECASE
    )
    if m:
        result['interest_rate'] = float(m.group(1))

    m = re.search(r'(\d{1,3})\s*months', text, re.IGNORECASE)
    if m:
        result['tenure_months'] = int(m.group(1))

    m = re.search(
        r'emi[^\d]{0,30}?(?:INR\s*)?(\d{4,7})\s*(?:per\s+month)?',
        text, re.IGNORECASE
    )
    if m:
        result['emi_stated'] = float(m.group(1))

    m = re.search(
        r'processing\s+fee[^\d]{0,30}?(?:INR\s*)?(\d{3,7})',
        text, re.IGNORECASE
    )
    if m:
        result['processing_fee'] = float(m.group(1))

    m = re.search(
        r'processing\s+fee[^\d]{0,15}?(\d{1,2}(?:\.\d{1,2})?)\s*%',
        text, re.IGNORECASE
    )
    if m:
        result['processing_fee_percent'] = float(m.group(1))

    # Penal interest — monthly → annualise, else read annual directly
    m = re.search(
        r'penal[^\d]{0,30}?(\d{1,2}(?:\.\d{1,2})?)\s*%\s*per\s+month',
        text, re.IGNORECASE
    )
    if m:
        result['penal_interest_rate'] = float(m.group(1)) * 12
    else:
        m = re.search(
            r'penal[^\d]{0,30}?(\d{1,2}(?:\.\d{1,2})?)\s*%',
            text, re.IGNORECASE
        )
        if m:
            result['penal_interest_rate'] = float(m.group(1))

    m = re.search(
        r'bounce[^\d]{0,30}?(?:INR\s*)?(\d{2,5})',
        text, re.IGNORECASE
    )
    if m:
        result['bounce_charge'] = float(m.group(1))

    m = re.search(
        r'(?:annual\s+percentage\s+rate|APR)[^\d]{0,20}?(\d{1,2}(?:\.\d{1,4})?)\s*%',
        text, re.IGNORECASE
    )
    if m:
        result['apr'] = float(m.group(1))

    if re.search(r'GST\s*@?\s*18\s*%', text, re.IGNORECASE):
        result['gst_percent'] = 18.0

    # ── Standard boolean clause flags ──────────────────────────────────────────

    result['floating_rate'] = bool(re.search(
        r'floating\s+rate|RLLR|repo.linked', text, re.IGNORECASE))

    result['rate_reset_clause'] = bool(re.search(
        r'rate\s+reset|revise.{0,20}interest\s+rate|interest\s+rate.{0,30}revised',
        text, re.IGNORECASE))

    result['bank_discretion_clause'] = bool(re.search(
        r'sole\s+discretion|at\s+its\s+discretion|lender.{0,15}discretion',
        text, re.IGNORECASE))

    result['auto_debit_consent'] = bool(re.search(
        r'NACH|ECS|auto.debit|auto\s+debit', text, re.IGNORECASE))

    result['recovery_agent_clause'] = bool(re.search(
        r'recovery\s+agent|collection\s+agent', text, re.IGNORECASE))

    result['foreclosure_clause'] = bool(re.search(
        r'foreclosure|prepayment', text, re.IGNORECASE))

    # ── Compliance presence flags (used by run_deterministic_checks) ───────────

    result['kfs_present'] = bool(re.search(
        r'key\s+fact\s+statement|KFS\b', text, re.IGNORECASE))

    result['grievance_redressal_present'] = bool(re.search(
        r'grievance|ombudsman|nodal\s+officer|complaint\s+redressal',
        text, re.IGNORECASE))

    result['cooling_off_period_present'] = bool(re.search(
        r'cooling[\s\-]off|cool\s+off|cancel.*without\s+penalty',
        text, re.IGNORECASE))

    result['apr_disclosed'] = bool(re.search(
        r'(?:annual\s+percentage\s+rate|APR)\s*[:\-]?\s*\d',
        text, re.IGNORECASE))

    result['penal_compounding'] = bool(re.search(
        r'compound(?:ed|ing).*penal|penal.*compound(?:ed|ing)|'
        r'capitaliz(?:ed|ing).*penal|penal.*capitaliz(?:ed|ing)|'
        r'capitalised.*penal|penal.*capitalised',
        text, re.IGNORECASE))

    result['irrevocable_nach'] = bool(re.search(
        r'irrevocable.*(?:NACH|ECS|mandate)|(?:NACH|ECS|mandate).*irrevocable|'
        r'cannot\s+be\s+revoked|cannot\s+be\s+cancelled.*mandate',
        text, re.IGNORECASE))

    result['data_sharing_consent'] = bool(re.search(
        r'third.party\s+marketing|marketing\s+partner|'
        r'share.*personal.*data.*marketing|affiliates.*without.*notice|'
        r'sell.*data|data.*sold',
        text, re.IGNORECASE))

    # ── String fields ──────────────────────────────────────────────────────────

    # Lender name — prefer explicit "Lender: <name>", fall back to company heuristic
    lender_found = False
    m = re.search(
        r'Lender:\s*([A-Z][^\n,|]{5,60}?)(?:\s*[,|\n])',
        text, re.IGNORECASE
    )
    if m:
        result['lender_name'] = m.group(1).strip()
        lender_found = True

    if not lender_found:
        m = re.search(
            r'([A-Z][a-zA-Z\s]+(?:Finance|Bank|NBFC|FinServ|Housing|Credit)'
            r'(?:\s+(?:Pvt\.?|Ltd\.?|Limited|Co\.))*)',
            text[:400], re.IGNORECASE
        )
        if m:
            result['lender_name'] = m.group(1).strip()

    m = re.search(
        r'Borrower(?:\s+Name)?:\s*([A-Z][a-zA-Z\s]{3,40}?)(?:,|\n|S/O|D/O|W/O)',
        text, re.IGNORECASE
    )
    if m:
        result['borrower_name'] = m.group(1).strip()

    # Loan type — order matters: specific types before generic "Personal Loan"
    for loan_type in ['Gold Loan', 'Home Loan', 'Credit Card', 'BNPL', 'Personal Loan']:
        if re.search(loan_type, text[:400], re.IGNORECASE):
            result['loan_type'] = loan_type
            break

    logger.info(f"Regex fallback extracted: {list(result.keys())}")
    return result

# ── OpenAI Extraction ──────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are an expert Indian financial document analyst. Extract ALL financial terms from this loan/credit card/NBFC agreement.

CRITICAL NUMBER FORMAT RULES:
- All numbers in the text have already been normalized (commas removed).
- "500000" means five lakhs (INR 5,00,000). "3600000" means INR 36 lakhs.
- "19800" means INR 19,800. Read all numbers as plain integers/floats.
- "INR" always precedes the amount — read the number immediately after it.
- If interest rate says "X% per month", multiply by 12 to get annual rate.

Return ONLY valid JSON with this exact schema:
{
  "principal": <number, 0 if not found>,
  "interest_rate": <annual % as number, 0 if not found>,
  "apr": <annual % as number, 0 if not found>,
  "emi_stated": <monthly EMI as number, 0 if not found>,
  "tenure_months": <integer, 0 if not found>,
  "processing_fee": <absolute amount as number, 0 if not found>,
  "processing_fee_percent": <% as number, 0 if not found>,
  "penal_interest_rate": <annual % as number, 0 if not found>,
  "gst_percent": <number, 18 if GST mentioned, else 0>,
  "bounce_charge": <per-instance amount as number, 0 if not found>,
  "foreclosure_clause": <true/false>,
  "auto_debit_consent": <true/false>,
  "recovery_agent_clause": <true/false>,
  "floating_rate": <true/false>,
  "rate_reset_clause": <true/false>,
  "bank_discretion_clause": <true/false>,
  "kfs_present": <true if "Key Fact Statement" or "KFS" section exists, else false>,
  "apr_disclosed": <true if APR value is explicitly stated as a number, else false>,
  "penal_compounding": <true if penal interest is compounded into principal, else false>,
  "irrevocable_nach": <true if NACH/ECS mandate described as irrevocable or non-cancellable, else false>,
  "data_sharing_consent": <true if data shared with marketing/third parties without separate consent, else false>,
  "cooling_off_period_present": <true if cooling-off or cancellation period mentioned, else false>,
  "grievance_redressal_present": <true if grievance/ombudsman/nodal officer mentioned, else false>,
  "loan_type": <"Personal Loan" | "Home Loan" | "Gold Loan" | "Credit Card" | "BNPL" | "Other">,
  "lender_name": <string, "" if not found>,
  "borrower_name": <string, "" if not found>,
  "agreement_date": <string "DD Month YYYY", "" if not found>,
  "raw_text_excerpt": ""
}

STRICT RULES:
- Return ONLY JSON, no markdown, no explanation.
- Use 0 for missing numeric values, "" for missing strings, false for missing booleans.
- Do NOT hallucinate. Only extract values explicitly stated in the document.
- For principal: look for "Principal Amount", "Loan Amount", "Sanctioned Amount".
- For emi_stated: look for "EMI", "Monthly Instalment", "Monthly Payment".

DOCUMENT TEXT:
"""


@retry(
    stop=stop_after_attempt(settings.openai_retries),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError)),
)
async def call_openai_extraction(text: str) -> dict:
    """Call OpenAI API for structured loan data extraction."""
    truncated_text = text[:8000]

    payload = {
        "model": settings.openai_model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a precise Indian financial document parser. "
                    "Always return valid JSON only. "
                    "Numbers have commas removed — 500000 = INR 5 lakhs, 19800 = INR 19,800."
                ),
            },
            {
                "role": "user",
                "content": EXTRACTION_PROMPT + truncated_text,
            },
        ],
        "temperature": settings.openai_temperature,
        "max_tokens": 1024,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=settings.openai_timeout) as client:
        response = await client.post(
            f"{settings.openai_base_url}/chat/completions",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        result = response.json()
        content = result["choices"][0]["message"]["content"]
        parsed = parse_json_payload(content)
        if not isinstance(parsed, dict):
            raise ValueError("Extraction response was not a JSON object")
        return parsed

# ── Merge Helper ───────────────────────────────────────────────────────────────

def merge_extractions(model_result: dict, regex_result: dict) -> dict:
    """
    Merge model + regex results.
    - Model wins when its value is non-zero / non-empty.
    - Regex fills gaps where the model returned 0 / "" / False.
    - Booleans: OR both — if either detects it, it's flagged.
    - Keys only in regex (not returned by the model at all) are always added.
    """
    merged = dict(model_result)
    for key, regex_val in regex_result.items():
        model_val = model_result.get(key)
        if key not in model_result:
            # Model didn't return this key at all — always take regex value
            if regex_val is not None:
                merged[key] = regex_val
                logger.debug(f"Regex added missing key '{key}': {regex_val}")
        elif isinstance(model_val, bool):
            # OR boolean flags — if either detects it, flag it
            if not model_val and regex_val:
                merged[key] = True
        elif isinstance(model_val, (int, float)):
            if model_val == 0 and regex_val:
                merged[key] = regex_val
                logger.debug(f"Regex filled '{key}': {regex_val}")
        elif isinstance(model_val, str):
            if not model_val and regex_val:
                merged[key] = regex_val
                logger.debug(f"Regex filled '{key}': {regex_val}")
    return merged

# ── Main Entry Point ───────────────────────────────────────────────────────────

async def parse_document(
    file_bytes: Optional[bytes] = None,
    raw_text: Optional[str] = None,
) -> LoanExtraction:
    """Main entry point: extract loan data from PDF bytes or raw text."""

    # Step 1: Extract and preprocess text
    if file_bytes:
        raw = extract_text_from_pdf(file_bytes)
        text = preprocess_text(raw)
    elif raw_text:
        text = preprocess_text(raw_text)
    else:
        raise ValueError("Either file_bytes or raw_text must be provided")

    if len(text) < 50:
        logger.warning("Very short text extracted — may be scanned/image PDF")

    logger.info(f"Extracted {len(text)} characters from document (after normalization)")

    # Step 2: model extraction
    openai_data: dict = {}
    openai_ok = False
    try:
        openai_data = await call_openai_extraction(text)
        openai_ok = True
        logger.info(
            f"OpenAI extracted: principal={openai_data.get('principal')}, "
            f"rate={openai_data.get('interest_rate')}%, "
            f"tenure={openai_data.get('tenure_months')}m, "
            f"emi={openai_data.get('emi_stated')}"
        )
    except Exception as e:
        logger.error(f"OpenAI extraction failed: {e}")
        openai_data = {}

    # Step 3: Regex fallback extraction (always runs)
    regex_data = regex_extract_fallback(text)

    # Step 4: Merge
    merged = merge_extractions(openai_data, regex_data) if openai_ok else regex_data

    # Step 5: Principal scale sanity check
    openai_principal = openai_data.get('principal', 0)
    regex_principal = regex_data.get('principal', 0)
    if openai_principal > 0 and regex_principal > 0:
        ratio = max(openai_principal, regex_principal) / min(openai_principal, regex_principal)
        if ratio > 100:
            merged['principal'] = max(openai_principal, regex_principal)
            logger.warning(
                f"Principal scale mismatch: OpenAI={openai_principal}, "
                f"regex={regex_principal} — using {merged['principal']}"
            )

    # Step 6: Strip keys not in schema (Pydantic v2 — use model_fields not __fields__)
    valid_keys = set(LoanExtraction.model_fields.keys())
    clean_merged = {k: v for k, v in merged.items() if k in valid_keys}

    # Step 7: Build LoanExtraction
    try:
        extraction = LoanExtraction(**clean_merged)
        extraction.raw_text_excerpt = text[:300]
        extraction.full_extracted_text = text
        logger.info(
            f"Final extraction: principal={extraction.principal}, "
            f"rate={extraction.interest_rate}%, "
            f"tenure={extraction.tenure_months}m, "
            f"emi={extraction.emi_stated} | "
            f"kfs={extraction.kfs_present}, "
            f"apr_disclosed={extraction.apr_disclosed}, "
            f"penal_compound={extraction.penal_compounding}, "
            f"irrev_nach={extraction.irrevocable_nach}"
        )
        return extraction
    except Exception as e:
        logger.error(f"LoanExtraction construction failed: {e} | merged={clean_merged}")
        safe_regex = {k: v for k, v in regex_data.items() if k in valid_keys}
        fallback = LoanExtraction(**safe_regex)
        fallback.raw_text_excerpt = text[:300]
        fallback.full_extracted_text = text
        return fallback
