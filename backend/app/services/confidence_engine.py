from app.models.schemas import LoanExtraction, EMIAnalysis, Violation


LOW_CONFIDENCE_THRESHOLD = 0.60
SCANNED_PDF_WARNING = (
    "⚠️ LOW CONFIDENCE: Document may be scanned or fields are incomplete. "
    "All results require manual verification before legal action."
)


def compute_overall_confidence(
    extraction: LoanExtraction,
    emi_analysis: EMIAnalysis,
    violations: list[Violation],
) -> float:
    """
    Compute overall system confidence (0.0 – 1.0).
    Returns a plain float — audit.py assembles the full tuple.
    """
    scores = []

    # 1. Extraction completeness
    extraction_score = 0.0
    if extraction.principal > 0:
        extraction_score += 0.25
    if extraction.interest_rate > 0:
        extraction_score += 0.20
    if extraction.tenure_months > 0:
        extraction_score += 0.15
    if extraction.lender_name:
        extraction_score += 0.10
    if extraction.emi_stated > 0:
        extraction_score += 0.15
    if extraction.processing_fee > 0 or extraction.processing_fee_percent > 0:
        extraction_score += 0.10
    if extraction.kfs_present:
        extraction_score += 0.05
    scores.append(min(1.0, extraction_score))

    # 2. EMI analysis confidence
    emi_score = 0.0
    if emi_analysis.expected_emi > 0:
        emi_score = 0.9
    elif emi_analysis.stated_emi > 0:
        emi_score = 0.5
    scores.append(emi_score)

    # 3. Violation detection confidence
    if violations:
        avg_violation_conf = sum(v.confidence_score for v in violations) / len(violations)
        scores.append(avg_violation_conf)
    else:
        if extraction_score >= 0.7:
            scores.append(extraction_score * 0.9)
        else:
            scores.append(0.45)

    return round(min(1.0, sum(scores) / len(scores)), 4)


def get_confidence_warning(confidence: float) -> str:
    """
    Returns a warning string if confidence is below threshold, else "".
    Always returns str (never None) so audit.py unpack is safe.
    """
    if confidence < LOW_CONFIDENCE_THRESHOLD:
        return SCANNED_PDF_WARNING
    return ""


def compute_document_completeness(extraction: LoanExtraction) -> float:
    """Completeness score (0.0–1.0) based on how many key fields are populated."""
    score = 0.0
    total_fields = 10
    if extraction.principal > 0: score += 1
    if extraction.interest_rate > 0: score += 1
    if extraction.tenure_months > 0: score += 1
    if extraction.lender_name: score += 1
    if extraction.emi_stated > 0: score += 1
    if extraction.processing_fee > 0 or extraction.processing_fee_percent > 0: score += 1
    if extraction.borrower_name: score += 1
    if extraction.agreement_date: score += 1
    if extraction.kfs_present: score += 1
    if extraction.apr > 0: score += 1
    return round(score / total_fields, 2)
