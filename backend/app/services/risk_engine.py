from loguru import logger
from app.models.schemas import LoanExtraction, EMIAnalysis, Violation, RiskScore, BehavioralAlert
from typing import Optional


# ── Plain English Label Maps ───────────────────────────────────────────────────

_RISK_CATEGORY_PLAIN: dict[str, str] = {
    "LOW":      "LOW RISK — Your loan agreement looks mostly fine",
    "MEDIUM":   "MEDIUM RISK — Your agreement has some problems worth addressing",
    "HIGH":     "HIGH RISK — Your agreement has serious problems that cost you money",
    "CRITICAL": "CRITICAL RISK — Your agreement breaks multiple major laws and needs urgent action",
}

_APPEAL_PLAIN_TEMPLATES = [
    # (min_probability, message)
    (0.85, "You have an extremely strong case — {pct}% chance of winning if you file a complaint with RBI Ombudsman. Most banks settle at this level."),
    (0.70, "You have a strong case — {pct}% chance of winning a complaint. File all three escalation letters in order."),
    (0.50, "You have a reasonable case — {pct}% chance of success. The violations are real but the financial impact is moderate."),
    (0.30, "You have some grounds to complain — {pct}% estimated success. Document everything carefully before filing."),
    (0.00, "The agreement has minor issues, but your chance of a successful complaint is low at {pct}%. Still worth raising with the bank directly."),
]

# Score component labels in order — matches score_breakdown_plain list order
_SCORE_COMPONENT_LABELS = [
    # (field_name, max_score, label_template)
    # label_template uses {score} and {max}
    ("emi_deviation_score",  25, "Monthly payment (EMI) accuracy"),
    ("hidden_fee_score",     20, "Hidden and undisclosed fees"),
    ("rbi_violation_score",  25, "RBI rule violations"),
    ("penal_stacking_score", 10, "Penalty stacking on missed payments"),
    ("transparency_score",   10, "How transparent the bank is about costs"),
    ("ambiguity_score",      10, "How many vague or one-sided clauses exist"),
    ("behavioral_risk_score", 10, "Threatening or manipulative language"),
]


def _build_score_breakdown_plain(
    emi_score: float,
    hidden_fee_score: float,
    rbi_score: float,
    penal_score: float,
    transparency_score: float,
    ambiguity_score: float,
    behavioral_score: float,
) -> list[str]:
    """
    Returns 7 plain English strings, one per score component.
    Each sentence explains what the score means in human terms.
    """
    scores = [emi_score, hidden_fee_score, rbi_score, penal_score,
              transparency_score, ambiguity_score, behavioral_score]

    labels = []
    for (_, max_score, label), score in zip(_SCORE_COMPONENT_LABELS, scores):
        ratio = score / max_score if max_score > 0 else 0

        if label == "Monthly payment (EMI) accuracy":
            if ratio == 0:
                labels.append("✅ Your monthly payment (EMI) matches the correct calculation")
            elif ratio < 0.3:
                labels.append("⚠️ Your EMI is slightly higher than it should be — small overcharge")
            elif ratio < 0.6:
                labels.append("🔴 Your EMI is noticeably higher than the correct amount — you're overpaying monthly")
            else:
                labels.append("🚨 Your EMI is significantly wrong — you're being seriously overcharged every month")

        elif label == "Hidden and undisclosed fees":
            if ratio == 0:
                labels.append("✅ No hidden fees were detected in your agreement")
            elif ratio < 0.4:
                labels.append("⚠️ Some fees were not clearly disclosed upfront")
            else:
                labels.append("🔴 Significant hidden fees found — costs you were not told about clearly")

        elif label == "RBI rule violations":
            if ratio == 0:
                labels.append("✅ No RBI rule violations detected")
            elif ratio < 0.4:
                labels.append("⚠️ A few RBI rules were not followed by the bank")
            elif ratio < 0.7:
                labels.append("🔴 Multiple RBI rules were broken — your rights were violated")
            else:
                labels.append("🚨 Your bank broke many RBI rules — this is a strong legal case")

        elif label == "Penalty stacking on missed payments":
            if ratio == 0:
                labels.append("✅ Penalty charges are within acceptable limits")
            elif ratio < 0.5:
                labels.append("⚠️ Multiple penalties apply if you miss a payment — adds up quickly")
            else:
                labels.append("🔴 Severe penalty stacking — missing one payment could trigger a debt spiral")

        elif label == "How transparent the bank is about costs":
            if ratio == 0:
                labels.append("✅ The bank is transparent about all costs and terms")
            elif ratio < 0.4:
                labels.append("⚠️ Some important cost information was not clearly disclosed")
            else:
                labels.append("🔴 The bank is hiding important information about the true cost of your loan")

        elif label == "How many vague or one-sided clauses exist":
            if ratio == 0:
                labels.append("✅ Agreement terms are reasonably clear and balanced")
            elif ratio < 0.4:
                labels.append("⚠️ Some clauses are vague and favour the bank over you")
            else:
                labels.append("🔴 Many clauses are deliberately unclear and give the bank one-sided power")

        elif label == "Threatening or manipulative language":
            if ratio == 0:
                labels.append("✅ No threatening or manipulative language found")
            elif ratio < 0.5:
                labels.append("⚠️ Agreement uses some aggressive or intimidating language")
            else:
                labels.append("🔴 Agreement uses threatening and manipulative language to scare you into compliance")

    return labels


def _build_risk_summary_plain(
    risk_category: str,
    violations: list[Violation],
    emi_analysis: EMIAnalysis,
    extraction: LoanExtraction,
    appeal_probability: float,
    behavioral_alert: Optional[BehavioralAlert],
) -> str:
    """
    Builds a single plain English paragraph summarising the entire risk assessment.
    Written like a knowledgeable friend explaining the situation.
    """
    total_violations = len(violations)
    critical_count = sum(1 for v in violations if v.severity == "CRITICAL")
    high_count     = sum(1 for v in violations if v.severity == "HIGH")
    overcharge     = emi_analysis.overcharge_estimate
    lender         = extraction.lender_name or "your lender"
    appeal_pct     = int(appeal_probability * 100)

    # Opening sentence based on risk category
    opening_map = {
        "LOW": f"Your loan agreement with {lender} is mostly compliant, but we found {total_violations} minor issue(s) worth knowing about.",
        "MEDIUM": f"Your loan agreement with {lender} has {total_violations} problem(s) that are costing you money and violating some RBI rules.",
        "HIGH": f"Your loan agreement with {lender} has serious problems — we found {total_violations} violation(s) including {high_count} major ones.",
        "CRITICAL": f"Your loan agreement with {lender} is severely non-compliant — {total_violations} violation(s) found, including {critical_count} critical breach(es) of RBI law.",
    }
    opening = opening_map.get(risk_category, f"We found {total_violations} issue(s) in your loan agreement.")

    # Overcharge sentence
    if overcharge > 1000:
        overcharge_sentence = (
            f" You are being overcharged approximately ₹{overcharge:,.0f} in total — "
            f"money that should not have been taken from you."
        )
    elif overcharge > 0:
        overcharge_sentence = f" There is a small overcharge of ₹{overcharge:,.0f} in your loan."
    else:
        overcharge_sentence = " No significant financial overcharge was detected."

    # Behavioral sentence
    behavioral_sentence = ""
    if behavioral_alert and (
        behavioral_alert.threat_language_detected or
        behavioral_alert.aggressive_tone_detected or
        behavioral_alert.consent_misuse_detected
    ):
        behavioral_sentence = (
            " The agreement also uses threatening and manipulative language "
            "designed to intimidate you — remember, many of these clauses are not legally enforceable."
        )

    # Closing sentence with appeal probability
    if appeal_probability >= 0.80:
        closing = (
            f" The good news: you have a {appeal_pct}% chance of winning "
            f"if you file a formal complaint — that's an extremely strong case."
        )
    elif appeal_probability >= 0.60:
        closing = (
            f" You have a {appeal_pct}% chance of winning a formal complaint — "
            f"a solid case worth pursuing."
        )
    elif appeal_probability >= 0.40:
        closing = (
            f" You have a {appeal_pct}% chance of success if you file a complaint. "
            f"Document your evidence carefully before doing so."
        )
    else:
        closing = (
            f" Your appeal success probability is {appeal_pct}%. "
            f"Consider consulting a financial advisor before filing a complaint."
        )

    return opening + overcharge_sentence + behavioral_sentence + closing


def _build_appeal_plain(appeal_probability: float) -> str:
    """Returns a plain English sentence about the appeal success probability."""
    pct = int(appeal_probability * 100)
    for min_prob, template in _APPEAL_PLAIN_TEMPLATES:
        if appeal_probability >= min_prob:
            return template.format(pct=pct)
    return f"Your estimated appeal success probability is {pct}%."


# ── Main Risk Engine ───────────────────────────────────────────────────────────

def compute_risk_score(
    extraction: LoanExtraction,
    emi_analysis: EMIAnalysis,
    violations: list[Violation],
    behavioral_alert: Optional[BehavioralAlert] = None,
) -> RiskScore:
    """
    Compute weighted risk intelligence score (0–100).
    Components:
      EMI deviation    : 0–25 pts
      Hidden fees      : 0–20 pts
      RBI violations   : 0–25 pts
      Penal stacking   : 0–10 pts
      Transparency     : 0–10 pts  (bank_discretion not double-counted)
      Ambiguity        : 0–10 pts
      Behavioral       : 0–10 pts
    Total              : 0–110 → capped at 100
    """

    # 1. EMI Deviation Score (0–25)
    emi_score = 0.0
    if emi_analysis.emi_deviation_percent > 0:
        emi_score = min(25.0, emi_analysis.emi_deviation_percent * 5)

    # 2. Hidden Fee Score (0–20)
    hidden_fee_score = 0.0
    if extraction.principal > 0 and emi_analysis.hidden_fee_impact > 0:
        fee_ratio = emi_analysis.hidden_fee_impact / extraction.principal * 100
        hidden_fee_score = min(20.0, fee_ratio * 4)

    # 3. RBI Violation Score (0–25)
    severity_weights = {"LOW": 2, "MEDIUM": 5, "HIGH": 10, "CRITICAL": 15}
    rbi_score = 0.0
    for v in violations:
        rbi_score += severity_weights.get(v.severity, 3) * v.confidence_score
    rbi_score = min(25.0, rbi_score)

    # 4. Penal Stacking Score (0–10)
    penal_score = 0.0
    if extraction.principal > 0 and emi_analysis.penal_stacking_impact > 0:
        penal_ratio = emi_analysis.penal_stacking_impact / extraction.principal * 100
        penal_score = min(10.0, penal_ratio * 10)

    # 5. Transparency Score (0–10)
    transparency_score = 0.0
    if extraction.apr == 0:
        transparency_score += 3
    if not extraction.foreclosure_clause:
        transparency_score += 2
    if extraction.bank_discretion_clause:
        transparency_score += 3
    if extraction.floating_rate and not extraction.rate_reset_clause:
        transparency_score += 2
    if not extraction.kfs_present:
        transparency_score += 2
    transparency_score = min(10.0, transparency_score)

    # 6. Ambiguity Score (0–10)
    ambiguity_score = 0.0
    if extraction.floating_rate and not extraction.rate_reset_clause:
        ambiguity_score += 3
    if extraction.recovery_agent_clause and not extraction.auto_debit_consent:
        ambiguity_score += 3
    if extraction.bank_discretion_clause and not extraction.rate_reset_clause:
        ambiguity_score += 2
    if extraction.moratorium_period_months > 0 and extraction.insurance_premium > 0:
        ambiguity_score += 2
    ambiguity_score = min(10.0, ambiguity_score)

    # 7. Behavioral Score (0–10)
    behavioral_score = 0.0
    if behavioral_alert:
        if behavioral_alert.threat_language_detected:
            behavioral_score += 4
        if behavioral_alert.aggressive_tone_detected:
            behavioral_score += 2
        if behavioral_alert.consent_misuse_detected:
            behavioral_score += 3
        if behavioral_alert.data_abuse_clause_detected:
            behavioral_score += 3
    behavioral_score = min(10.0, behavioral_score)

    total_score = round(
        emi_score + hidden_fee_score + rbi_score +
        penal_score + transparency_score + ambiguity_score + behavioral_score,
        2
    )
    total_score = min(100.0, total_score)

    # Risk Category thresholds
    if total_score < 20:
        risk_category = "LOW"
    elif total_score < 40:
        risk_category = "MEDIUM"
    elif total_score < 65:
        risk_category = "HIGH"
    else:
        risk_category = "CRITICAL"

    # Appeal Success Probability
    appeal_probability = round(min(0.95, total_score / 100 * 1.3 + 0.2), 2)
    if total_score < 10:
        appeal_probability = 0.15

    # ── Build all plain English fields ────────────────────────────────────
    score_breakdown_plain = _build_score_breakdown_plain(
        emi_score, hidden_fee_score, rbi_score,
        penal_score, transparency_score, ambiguity_score, behavioral_score,
    )

    risk_summary_plain = _build_risk_summary_plain(
        risk_category, violations, emi_analysis,
        extraction, appeal_probability, behavioral_alert,
    )

    logger.info(
        f"Risk Score: {total_score} | Category: {risk_category} | "
        f"Appeal: {appeal_probability} | Behavioral: {behavioral_score}"
    )

    return RiskScore(
        total_score=total_score,
        emi_deviation_score=round(emi_score, 2),
        hidden_fee_score=round(hidden_fee_score, 2),
        rbi_violation_score=round(rbi_score, 2),
        penal_stacking_score=round(penal_score, 2),
        transparency_score=round(transparency_score, 2),
        ambiguity_score=round(ambiguity_score, 2),
        behavioral_risk_score=round(behavioral_score, 2),     # fixed field name from schemas.py
        risk_category=risk_category,
        appeal_success_probability=appeal_probability,
        # ── Plain English fields ──────────────────────────────────────────
        risk_category_plain=_RISK_CATEGORY_PLAIN[risk_category],
        risk_summary_plain=risk_summary_plain,
        score_breakdown_plain=score_breakdown_plain,
        appeal_plain=_build_appeal_plain(appeal_probability),
    )
