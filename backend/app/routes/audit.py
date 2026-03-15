import asyncio
import time
from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import Response
from loguru import logger
from pydantic import BaseModel
from typing import Literal

from app.models.schemas import AuditResponse, KeyAction
from app.services.parser import parse_document
from app.services.emi_engine import analyze_emi
from app.services.violation_detector import detect_violations, detect_behavioral_issues
from app.services.escalation_generator import generate_escalations, generate_escalation_pdf
from app.services.risk_engine import compute_risk_score
from app.services.confidence_engine import (
    compute_overall_confidence,
    compute_document_completeness,
    get_confidence_warning,
)
from app.services.translation_service import (
    translate_audit_response,
    get_cache_stats,
    SUPPORTED_LANGUAGES,
)


router = APIRouter(prefix="/api/audit", tags=["audit"])


# ── Translation request schema ──────────────────────────────────────────────────

class TranslateRequest(BaseModel):
    audit_response: AuditResponse
    target_language: Literal["en", "hi", "te", "ta", "ml"]



# ── Plain English Builders ─────────────────────────────────────────────────────

def _build_plain_summary(
    extraction,
    emi_analysis,
    violations,
    risk_score,
    behavioral_alert,
) -> str:
    """
    Builds the top-level plain English paragraph shown at the very top of the report.
    Written like a knowledgeable friend summarising the situation in 3–4 sentences.
    Uses risk_score.risk_summary_plain if already built — avoids duplication.
    """
    # risk_engine already builds a comprehensive summary — use it if available
    if hasattr(risk_score, 'risk_summary_plain') and risk_score.risk_summary_plain:
        return risk_score.risk_summary_plain

    # Fallback: construct one here
    total = len(violations)
    critical = sum(1 for v in violations if v.severity == "CRITICAL")
    high = sum(1 for v in violations if v.severity == "HIGH")
    overcharge = emi_analysis.overcharge_estimate
    lender = extraction.lender_name or "your lender"
    appeal_pct = int(risk_score.appeal_success_probability * 100)

    opening = (
        f"We checked your loan agreement with {lender} and found {total} problem(s)."
        if total > 0 else
        f"We checked your loan agreement with {lender} and found no major violations."
    )

    violation_detail = ""
    if critical > 0:
        # Find the most severe violation and use its plain_english field
        critical_violation = next(
            (v for v in violations if v.severity == "CRITICAL"),
            None
        )
        if critical_violation and hasattr(critical_violation, 'plain_english') and critical_violation.plain_english:
            violation_detail = f" The most serious one: {critical_violation.plain_english.lower().rstrip('.')}."
    elif high > 0:
        violation_detail = f" There are {high} significant rule violations that directly affect you."

    overcharge_sentence = (
        f" On top of that, you are being overcharged approximately ₹{overcharge:,.0f}."
        if overcharge > 500 else
        f" No significant financial overcharge was detected."
    )

    closing = (
        f" The good news: you have a {appeal_pct}% chance of winning if you file a "
        f"formal complaint — use the letters below to get started."
        if appeal_pct >= 60 else
        f" Your appeal success probability is {appeal_pct}% — document your evidence carefully."
    )

    return opening + violation_detail + overcharge_sentence + closing


def _build_critical_violations_plain(violations) -> list[str]:
    """
    Returns plain English sentences for CRITICAL violations only.
    Shown prominently at the top of the violations section.
    Uses plain_english field if available, else falls back to issue_type.
    """
    critical = [v for v in violations if v.severity == "CRITICAL"]
    result = []
    for v in critical:
        if hasattr(v, 'plain_english') and v.plain_english:
            result.append(v.plain_english)
        else:
            result.append(f"CRITICAL: {v.issue_type} — this is a serious violation of RBI rules.")
    return result


def _build_document_completeness_plain(extraction, completeness: float) -> str:
    """
    Explains the document completeness score in plain English.
    Tells the user exactly what is missing and why it matters.
    """
    missing_items = []
    present_items = []

    if not extraction.kfs_present:
        missing_items.append(
            "Key Facts Statement (KFS) — a simple 1-page loan summary that banks are "
            "legally required to give you before you sign"
        )
    else:
        present_items.append("Key Facts Statement")

    if not extraction.apr_disclosed:
        missing_items.append(
            "Annual Percentage Rate (APR) — the true total cost of your loan including all fees"
        )
    else:
        present_items.append("APR disclosure")

    if not extraction.grievance_redressal_present:
        missing_items.append(
            "Grievance Redressal details — the name and contact of the officer you can complain to"
        )
    else:
        present_items.append("Grievance Redressal mechanism")

    if not extraction.cooling_off_period_present:
        missing_items.append(
            "Cooling-off period — a window where you could cancel the loan without penalty"
        )
    else:
        present_items.append("Cooling-off period clause")

    if completeness >= 0.8:
        return (
            f"Your loan document includes most of the required disclosures "
            f"({', '.join(present_items)}). It is reasonably complete."
        )
    elif completeness >= 0.4:
        missing_str = "; ".join(missing_items) if missing_items else "some required disclosures"
        return (
            f"Your loan document is missing important information: {missing_str}. "
            f"Banks are legally required to include these — their absence alone gives you "
            f"grounds to file a complaint."
        )
    else:
        missing_str = "; ".join(missing_items) if missing_items else "most required disclosures"
        return (
            f"Your loan document is significantly incomplete. It is missing: {missing_str}. "
            f"A loan agreement this incomplete is a strong sign of bad-faith lending. "
            f"This alone is enough to escalate to the RBI Ombudsman."
        )


def _build_key_actions(
    violations,
    emi_analysis,
    extraction,
    risk_score,
    behavioral_alert,
) -> list[KeyAction]:
    """
    Builds an ordered checklist of concrete next steps the borrower should take.
    Priority 1 = most urgent. Max 6 actions to avoid overwhelming the user.
    """
    actions: list[KeyAction] = []
    priority = 1

    # Action 1: Always — send Level 1 complaint letter if violations exist
    if violations:
        overcharge_str = (
            f" and demand a refund of ₹{emi_analysis.overcharge_estimate:,.0f}"
            if emi_analysis.overcharge_estimate > 500
            else ""
        )
        actions.append(KeyAction(
            priority=priority,
            action="Send the Level 1 complaint letter to your bank",
            description=(
                f"Use the complaint letter below addressed to the Grievance Redressal Officer "
                f"of {extraction.lender_name or 'your bank'}. Mention all violations{overcharge_str}. "
                f"Keep a copy and note the date you sent it."
            ),
            related_violation="",
        ))
        priority += 1

    # Action 2: Critical violation — escalate immediately
    critical_violations = [v for v in violations if v.severity == "CRITICAL"]
    if critical_violations:
        cv = critical_violations[0]
        plain = cv.plain_english if hasattr(cv, 'plain_english') and cv.plain_english else cv.issue_type
        actions.append(KeyAction(
            priority=priority,
            action="Flag the most critical violation explicitly in your complaint",
            description=(
                f"Your most serious issue is: '{plain}'. "
                f"Mention it in the first paragraph of every complaint letter — "
                f"this is your strongest argument."
            ),
            related_violation=cv.issue_type,
        ))
        priority += 1

    # Action 3: KFS missing — demand it
    if not extraction.kfs_present:
        actions.append(KeyAction(
            priority=priority,
            action="Demand your Key Facts Statement (KFS) from the bank",
            description=(
                "Write to the bank asking for the KFS — the 1-page summary of your loan. "
                "Banks are required by RBI law to provide this. If they refuse or cannot "
                "produce it, that refusal itself is evidence for your complaint."
            ),
            related_violation="Missing Key Fact Statement",
        ))
        priority += 1

    # Action 4: Behavioral — know your rights against threats
    if behavioral_alert and (
        behavioral_alert.threat_language_detected or
        behavioral_alert.aggressive_tone_detected
    ):
        actions.append(KeyAction(
            priority=priority,
            action="Know that the threatening language in your agreement is not fully enforceable",
            description=(
                "Your agreement uses threats about criminal cases, asset seizure, or credit "
                "score destruction. These clauses are designed to scare you — many are not "
                "automatically enforceable without a court order. Do not panic; consult a "
                "legal advisor before taking any action based on these threats."
            ),
            related_violation="",
        ))
        priority += 1

    # Action 5: Irrevocable NACH — cancel it if needed
    if extraction.irrevocable_nach:
        actions.append(KeyAction(
            priority=priority,
            action="Know you can cancel the auto-debit from your account",
            description=(
                "Despite what your agreement says, you always have the legal right to "
                "cancel NACH/ECS auto-debit by writing to your bank and giving notice. "
                "Contact your bank branch and submit a written cancellation request "
                "citing NPCI NACH Guidelines."
            ),
            related_violation="Irrevocable NACH/ECS Mandate",
        ))
        priority += 1

    # Action 6: High overcharge — document it
    if emi_analysis.overcharge_estimate > 1000:
        actions.append(KeyAction(
            priority=priority,
            action="Calculate and document your total overcharge amount",
            description=(
                f"You have been overcharged approximately ₹{emi_analysis.overcharge_estimate:,.0f}. "
                f"Collect all receipts, EMI statements, and fee deduction records. "
                f"Attach these as evidence to every complaint letter you send."
            ),
            related_violation="",
        ))
        priority += 1

    return actions[:6]  # Cap at 6 to avoid overwhelming the user


# ── Route Handlers ─────────────────────────────────────────────────────────────

@router.post("/upload", response_model=AuditResponse)
async def audit_document(file: UploadFile = File(...)):
    """Upload a PDF loan agreement and run full AI audit."""
    start_time = time.time()

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds 10MB limit")

    logger.info(f"Processing document: {file.filename} ({len(file_bytes)} bytes)")
    return await _run_full_audit(file_bytes=file_bytes, raw_text=None, start_time=start_time)


@router.post("/text", response_model=AuditResponse)
async def audit_text(raw_text: str = Form(...)):
    """Paste raw loan agreement text for audit."""
    start_time = time.time()

    if len(raw_text.strip()) < 50:
        raise HTTPException(status_code=400, detail="Text too short for analysis")

    logger.info(f"Processing raw text ({len(raw_text)} chars)")
    return await _run_full_audit(file_bytes=None, raw_text=raw_text, start_time=start_time)


# ── Core Audit Pipeline ────────────────────────────────────────────────────────

async def _run_full_audit(file_bytes, raw_text, start_time):
    """Orchestrate the complete audit pipeline."""

    # Stage 1: Parse & Extract
    logger.info("Stage 1: Extracting loan data...")
    extraction = await parse_document(file_bytes=file_bytes, raw_text=raw_text)

    # Stage 2: EMI Analysis (deterministic)
    logger.info("Stage 2: Running EMI engine...")
    emi_analysis = analyze_emi(extraction)

    # Stage 3+4: Violation detection + behavioral analysis (parallel)
    logger.info("Stage 3+4: Violation detection + behavioral analysis (parallel)...")
    raw_text_for_behavior = (
        extraction.full_extracted_text
        or extraction.raw_text_excerpt
        or raw_text
        or ""
    )
    violations, behavioral_alert = await asyncio.gather(
        detect_violations(extraction, emi_analysis),
        asyncio.to_thread(detect_behavioral_issues, raw_text_for_behavior),
    )

    # Stage 5: Escalation Generation
    logger.info("Stage 5: Generating escalation letters...")
    escalations = await generate_escalations(extraction, emi_analysis, violations)

    # Stage 6+7: Risk scoring + confidence (parallel)
    logger.info("Stage 6+7: Risk scoring + confidence (parallel)...")

    async def _risk():
        return await asyncio.to_thread(
            compute_risk_score,
            extraction, emi_analysis, violations, behavioral_alert,
            # FIX: behavioral_alert was missing from original call — risk score
            # now receives it so behavioral_risk_score is computed correctly
        )

    async def _confidence():
        conf = await asyncio.to_thread(
            compute_overall_confidence, extraction, emi_analysis, violations
        )
        completeness = compute_document_completeness(extraction)
        warning = get_confidence_warning(conf)
        return conf, completeness, warning

    risk_score, (confidence, completeness, low_confidence_warning) = await asyncio.gather(
        _risk(),
        _confidence(),
    )

    processing_ms = round((time.time() - start_time) * 1000, 2)
    logger.info(
        f"Audit complete in {processing_ms}ms | "
        f"Risk: {risk_score.risk_category} | "
        f"Violations: {len(violations)} | "
        f"Confidence: {confidence:.2f} | "
        f"Completeness: {completeness:.2f}"
    )

    if low_confidence_warning:
        logger.warning(low_confidence_warning)

    # ── Legacy compliance_summary (kept for backward compatibility) ──────────
    critical_count = sum(1 for v in violations if v.severity == "CRITICAL")
    high_count = sum(1 for v in violations if v.severity == "HIGH")
    compliance_summary = (
        f"Found {len(violations)} violation(s): {critical_count} CRITICAL, {high_count} HIGH. "
        f"Estimated overcharge: ₹{emi_analysis.overcharge_estimate:,.0f}. "
        f"Risk Category: {risk_score.risk_category}. "
        f"Appeal Success: {risk_score.appeal_success_probability * 100:.0f}%."
    )
    if low_confidence_warning:
        compliance_summary += f" {low_confidence_warning}"

    # ── Build all plain English fields for AuditResponse ────────────────────
    plain_summary = _build_plain_summary(
        extraction, emi_analysis, violations, risk_score, behavioral_alert
    )

    critical_violations_plain = _build_critical_violations_plain(violations)

    document_completeness_plain = _build_document_completeness_plain(
        extraction, completeness
    )

    key_actions = _build_key_actions(
        violations, emi_analysis, extraction, risk_score, behavioral_alert
    )

    logger.info(
        f"Plain English: {len(key_actions)} key actions built | "
        f"{len(critical_violations_plain)} critical violations summarised"
    )

    return AuditResponse(
        extraction=extraction,
        emi_analysis=emi_analysis,
        violations=violations,
        escalations=escalations,
        risk_score=risk_score,
        behavioral_alert=behavioral_alert,
        compliance_summary=compliance_summary,
        confidence_overall=confidence,
        document_completeness=completeness,
        processing_time_ms=processing_ms,
        # ── Plain English fields ──────────────────────────────────────────────
        plain_summary=plain_summary,
        key_actions=key_actions,
        critical_violations_plain=critical_violations_plain,
        document_completeness_plain=document_completeness_plain,
        low_confidence_warning=low_confidence_warning,
    )


# ── Translation Routes ─────────────────────────────────────────────────────────

@router.post("/translate", response_model=AuditResponse)
async def translate_audit(body: TranslateRequest):
    """Translate all plain-English prose fields of an AuditResponse."""
    lang = body.target_language
    if lang not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{lang}'. Supported: {list(SUPPORTED_LANGUAGES.keys())}",
        )
    if lang == "en":
        return body.audit_response
    logger.info(f"Translating AuditResponse to '{lang}' ({SUPPORTED_LANGUAGES[lang]})")
    try:
        translated = await translate_audit_response(body.audit_response, lang)
        return translated
    except Exception as exc:
        logger.error(f"Translation endpoint error: {exc}")
        raise HTTPException(status_code=500, detail=f"Translation failed: {exc}")


@router.get("/translate/languages")
async def supported_languages():
    """Return supported language codes and their display names."""
    return {"supported": [{"code": c, "name": n} for c, n in SUPPORTED_LANGUAGES.items()]}


@router.get("/translate/cache-stats")
async def translation_cache_stats():
    """Return the current translation cache size (for debugging)."""
    return get_cache_stats()


# ── PDF Download Route ─────────────────────────────────────────────────────────

@router.post("/download-pdf")
async def download_escalation_pdf(body: dict):
    """Generate and return escalation PDF as download."""
    from app.models.schemas import EscalationLevel, LoanExtraction

    try:
        escalations = [EscalationLevel(**e) for e in body.get("escalations", [])]
        extraction = LoanExtraction(**body.get("extraction", {}))
        pdf_bytes = generate_escalation_pdf(escalations, extraction)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=escalation_letters.pdf"},
        )
    except Exception as e:
        logger.error(f"PDF generation failed: {e}")
        raise HTTPException(status_code=500, detail="PDF generation failed")
