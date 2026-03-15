"""
advisor.py — Spend Advisor API
────────────────────────────────
Endpoints:
  POST /api/advisor/analyze        → Upload files, get spending analysis
  POST /api/advisor/allocation     → Get allocation plan based on risk profile
  POST /api/advisor/risk-profile   → Score risk quiz answers
"""

import asyncio
import tempfile
import os
from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from typing import List, Optional
from loguru import logger

from app.services.vision_extractor import extract_financial_data, VisionExtractionError
from app.services.brain_reasoner import (
    comprehensive_financial_analysis,
    calculate_allocation,
    calculate_risk_profile,
    ReasoningError,
)

router = APIRouter(prefix="/api/advisor", tags=["advisor"])

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}


@router.post("/analyze")
async def analyze_spending(files: List[UploadFile] = File(...)):
    """
    Accept multiple files (bank statement, Amazon orders, Flipkart orders).
    Run vision extraction + brain reasoning + health scoring.
    Return comprehensive financial analysis.
    """

    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required")

    if len(files) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 files allowed")

    for f in files:
        ext = os.path.splitext(f.filename or "")[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"File '{f.filename}' is not supported. Allowed: PDF, JPG, PNG, WEBP"
            )

    master_records = []
    failed_files = []
    temp_paths = []

    try:
        for uploaded_file in files:
            file_bytes = await uploaded_file.read()
            if len(file_bytes) > 15 * 1024 * 1024:
                raise HTTPException(
                    status_code=400,
                    detail=f"File '{uploaded_file.filename}' exceeds 15MB limit"
                )

            ext = os.path.splitext(uploaded_file.filename or "file")[1].lower() or ".pdf"
            with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
                tmp.write(file_bytes)
                temp_paths.append((tmp.name, uploaded_file.filename))

        async def extract_one(tmp_path: str, original_name: str):
            try:
                logger.info(f"Extracting from: {original_name}")
                result = await asyncio.to_thread(
                    extract_financial_data, tmp_path, "Financial Document"
                )
                return result.get("extracted_records", [])
            except VisionExtractionError as e:
                logger.warning(f"Extraction failed for {original_name}: {e}")
                failed_files.append(original_name)
                return []

        results = await asyncio.gather(*[extract_one(p, n) for p, n in temp_paths])
        for records in results:
            master_records.extend(records)

    finally:
        for tmp_path, _ in temp_paths:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    if not master_records:
        raise HTTPException(
            status_code=422,
            detail="No transactions could be extracted from the uploaded files. "
                   "Please ensure files are clear bank statements or order pages."
        )

    combined_data = {"extracted_records": master_records}
    total_tx = sum(len(r.get("transactions", [])) for r in master_records)
    logger.info(f"Total transactions extracted: {total_tx} from {len(master_records)} records")

    try:
        # Add 120-second timeout for comprehensive analysis
        logger.info("Starting comprehensive financial analysis...")
        analysis = await asyncio.wait_for(
            asyncio.to_thread(comprehensive_financial_analysis, combined_data),
            timeout=120.0
        )
        logger.info("Analysis completed successfully")
    except asyncio.TimeoutError:
        logger.error(f"Analysis timed out after 120 seconds with {total_tx} transactions")
        raise HTTPException(
            status_code=504,
            detail="Analysis is taking too long. Please try with fewer transactions or files."
        )
    except ReasoningError as e:
        logger.error(f"Brain reasoning failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

    analysis["meta"] = {
        "files_processed": len(temp_paths) - len(failed_files),
        "files_failed": len(failed_files),
        "failed_file_names": failed_files,
        "total_transactions": total_tx,
    }

    return analysis


@router.post("/risk-profile")
async def score_risk_profile(answers: dict):
    """
    Score the risk quiz answers and return a risk profile.

    Expected body:
    {
        "q1": "A" | "B" | "C",
        "q2": "A" | "B" | "C",
        "q3": "A" | "B" | "C"
    }
    """
    required_keys = {"q1", "q2", "q3"}
    if not required_keys.issubset(answers.keys()):
        raise HTTPException(
            status_code=400,
            detail=f"Missing answers. Required: {required_keys}"
        )

    valid_options = {"A", "B", "C"}
    for key in required_keys:
        if answers[key].upper() not in valid_options:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid answer for {key}. Must be A, B, or C."
            )

    normalized = {k: answers[k].upper() for k in required_keys}
    profile = calculate_risk_profile(normalized)

    return {
        "risk_profile": profile,
        "answers": normalized,
    }


@router.post("/allocation")
async def get_allocation(body: dict):
    """
    Calculate monthly allocation plan.

    Expected body:
    {
        "detected_income": 42000.0,
        "user_income": 45000.0,            ← optional, overrides detected
        "total_expenses": 28000.0,
        "existing_monthly_savings": 2000.0,
        "risk_profile": "Moderate",
        "existing_fd_rd": 300000.0,        ← optional, from savings form
        "existing_mf": 50000.0,            ← optional, from savings form
        "existing_other": 0.0              ← optional, from savings form
    }
    """
    required_keys = {"total_expenses", "risk_profile"}
    if not required_keys.issubset(body.keys()):
        raise HTTPException(
            status_code=400,
            detail=f"Missing required fields: {required_keys}"
        )

    valid_profiles = {"Conservative", "Moderate", "Aggressive"}
    if body["risk_profile"] not in valid_profiles:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid risk_profile. Must be one of: {valid_profiles}"
        )

    result = calculate_allocation(
        detected_income=float(body.get("detected_income") or 0),
        user_income=float(body.get("user_income") or 0),
        total_expenses=float(body.get("total_expenses") or 0),
        existing_monthly_savings=float(body.get("existing_monthly_savings") or 0),
        risk_profile=body["risk_profile"],
        existing_fd_rd=float(body.get("existing_fd_rd") or 0),
        existing_mf=float(body.get("existing_mf") or 0),
        existing_other=float(body.get("existing_other") or 0),
    )

    return result
