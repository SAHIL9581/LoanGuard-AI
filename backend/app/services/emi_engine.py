from loguru import logger
from app.models.schemas import LoanExtraction, EMIAnalysis


# FIX: configurable penal stacking window (months of default scenario)
PENAL_STACKING_MONTHS = 3

# FIX: RBI-aligned processing fee caps by loan type
PROCESSING_FEE_CAPS = {
    "home": 0.005,
    "education": 0.0,
    "personal": 0.02,
    "auto": 0.01,
    "gold": 0.01,
    "credit_card": 0.03,
    "business": 0.02,
    "nbfc": 0.02,
    "default": 0.02,
}


# ── Plain English Helpers ──────────────────────────────────────────────────────

def _get_deviation_verdict(deviation_pct: float) -> str:
    """
    Converts a raw deviation percentage into a human-readable severity label.
    Used as the deviation_verdict field on EMIAnalysis.
    """
    if deviation_pct == 0:
        return "OK"
    elif deviation_pct < 0.5:
        return "MINOR"
    elif deviation_pct < 1.5:
        return "SIGNIFICANT"
    else:
        return "CRITICAL"


def _build_emi_plain_summary(
    expected_emi: float,
    stated_emi: float,
    deviation_pct: float,
    deviation_verdict: str,
    tenure: float,
) -> str:
    """
    Returns a single plain English sentence summarising the EMI comparison.
    Written so an 18-year-old with no finance background can understand it.
    """
    if stated_emi <= 0 or expected_emi <= 0:
        return "We could not verify your monthly payment amount — no EMI was stated in the agreement."

    diff = stated_emi - expected_emi

    if deviation_verdict == "OK":
        return (
            f"✅ Your monthly payment (EMI) of ₹{stated_emi:,.0f} matches the correct "
            f"calculation of ₹{expected_emi:,.0f} — no overcharge here."
        )
    elif deviation_verdict == "MINOR":
        return (
            f"⚠️ Your bank says you pay ₹{stated_emi:,.0f}/month but the correct amount "
            f"is ₹{expected_emi:,.0f}. You're paying ₹{diff:,.0f} extra per month "
            f"({deviation_pct:.2f}% higher than it should be)."
        )
    elif deviation_verdict == "SIGNIFICANT":
        return (
            f"🔴 Your monthly payment (EMI) of ₹{stated_emi:,.0f} is higher than the "
            f"mathematically correct amount of ₹{expected_emi:,.0f}. "
            f"You're being overcharged ₹{diff:,.0f} every single month ({deviation_pct:.2f}% excess)."
        )
    else:  # CRITICAL
        return (
            f"🚨 CRITICAL: Your bank is charging ₹{stated_emi:,.0f}/month but the correct "
            f"EMI is only ₹{expected_emi:,.0f}. That's ₹{diff:,.0f} extra per month — "
            f"a {deviation_pct:.2f}% overcharge that is mathematically proven."
        )


def _build_overcharge_plain(
    overcharge: float,
    tenure: int,
    stated_emi: float,
    expected_emi: float,
    processing_fee: float,
    principal: float,
    deviation_verdict: str,
) -> str:
    """
    Returns a plain English explanation of the total overcharge amount
    and what it means in real-world terms for the borrower.
    """
    if overcharge <= 0:
        return "✅ No significant overcharge was detected in your loan agreement."

    monthly_diff = stated_emi - expected_emi if stated_emi > expected_emi else 0
    years = tenure // 12
    months_remaining = tenure % 12

    # Build tenure description
    if years > 0 and months_remaining > 0:
        tenure_str = f"{years} year{'s' if years > 1 else ''} and {months_remaining} month{'s' if months_remaining > 1 else ''}"
    elif years > 0:
        tenure_str = f"{years} year{'s' if years > 1 else ''}"
    else:
        tenure_str = f"{tenure} months"

    # Build the explanation based on what's driving the overcharge
    parts = []

    if monthly_diff > 0 and deviation_verdict in ("SIGNIFICANT", "CRITICAL"):
        parts.append(
            f"Over your {tenure_str} loan, paying ₹{monthly_diff:,.0f} extra every month "
            f"adds up to ₹{monthly_diff * tenure:,.0f} in EMI overcharges alone."
        )

    if processing_fee > 0 and principal > 0:
        allowed_fee = round(PROCESSING_FEE_CAPS.get("personal", 0.02) * principal, 0)
        if processing_fee > allowed_fee:
            excess = processing_fee - allowed_fee
            parts.append(
                f"Your processing fee of ₹{processing_fee:,.0f} exceeds the permitted "
                f"₹{allowed_fee:,.0f} by ₹{excess:,.0f} — this was deducted from your "
                f"loan before you even received the money."
            )

    if not parts:
        parts.append(
            f"This overcharge is the total extra amount you paid or will pay "
            f"beyond what is legally permitted."
        )

    parts.append(
        f"In total, you have been overcharged approximately ₹{overcharge:,.0f}. "
        f"You have the right to demand this refunded."
    )

    return " ".join(parts)


# ── Core Calculation Functions ─────────────────────────────────────────────────

def compute_emi(principal: float, annual_rate: float, tenure_months: int) -> float:
    """
    Deterministic EMI using standard reducing balance formula.
    EMI = P × r × (1+r)^n / ((1+r)^n − 1)
    """
    if principal <= 0 or tenure_months <= 0:
        return 0.0

    if annual_rate <= 0:
        return round(principal / tenure_months, 2)

    r = annual_rate / (12 * 100)
    n = tenure_months

    numerator = principal * r * ((1 + r) ** n)
    denominator = ((1 + r) ** n) - 1

    if denominator == 0:
        return 0.0

    return round(numerator / denominator, 2)


def compute_effective_rate(principal: float, emi: float, tenure_months: int) -> float:
    """
    Compute effective annual interest rate from EMI using Newton-Raphson.
    FIX: clamps r to valid range [0.0001, 0.99] to prevent divergence.
    """
    if principal <= 0 or emi <= 0 or tenure_months <= 0:
        return 0.0

    if emi * tenure_months <= principal:
        return 0.0

    r = 0.01  # Initial guess: 1% monthly
    for _ in range(1000):
        try:
            powered = (1 + r) ** tenure_months
            f = principal * r * powered / (powered - 1) - emi
            df = (
                principal
                * (powered * (1 + tenure_months * r) - (1 + r))
                / ((1 + r) * ((powered - 1) ** 2))
            )
            if df == 0:
                break
            r_new = r - f / df
            r_new = max(0.0001, min(r_new, 0.99))
            if abs(r_new - r) < 1e-10:
                r = r_new
                break
            r = r_new
        except (ZeroDivisionError, OverflowError):
            break

    if r <= 0:
        return 0.0

    return round(r * 12 * 100, 4)  # Annualized


def compute_overcharge(
    total_stated: float,
    total_expected: float,
    processing_fee: float,
    processing_fee_pct: float,
    principal: float,
    gst_pct: float,
    loan_type: str,
) -> float:
    """
    FIX: only count processing fee as overcharge if it EXCEEDS the
    RBI-aligned cap for that loan type — not blindly always.
    """
    overcharge = 0.0

    # Repayment overcharge
    if total_stated > total_expected > 0:
        overcharge += round(total_stated - total_expected, 2)

    # Resolve effective processing fee
    eff_fee = processing_fee
    if eff_fee == 0 and processing_fee_pct > 0 and principal > 0:
        eff_fee = round((processing_fee_pct / 100) * principal, 2)

    # GST on processing fee is legitimate — do not include
    cap_pct = PROCESSING_FEE_CAPS.get(loan_type.lower(), PROCESSING_FEE_CAPS["default"])
    permitted_fee = round(cap_pct * principal, 2)

    if eff_fee > permitted_fee and principal > 0:
        excess_fee = round(eff_fee - permitted_fee, 2)
        gst_on_excess = round(excess_fee * (gst_pct / 100), 2)
        overcharge += excess_fee + gst_on_excess

    return round(overcharge, 2)


# ── Main Analyzer ──────────────────────────────────────────────────────────────

def analyze_emi(extraction: LoanExtraction) -> EMIAnalysis:
    """Run complete EMI analysis against stated loan terms."""
    principal           = extraction.principal
    annual_rate         = extraction.interest_rate
    tenure              = extraction.tenure_months
    stated_emi          = extraction.emi_stated
    processing_fee      = extraction.processing_fee
    processing_fee_pct  = extraction.processing_fee_percent
    gst_pct             = extraction.gst_percent
    penal_rate          = extraction.penal_interest_rate
    loan_type           = extraction.loan_type or "personal"

    # Resolve processing fee
    if processing_fee == 0 and processing_fee_pct > 0 and principal > 0:
        processing_fee = round((processing_fee_pct / 100) * principal, 2)

    gst_on_fee      = round(processing_fee * (gst_pct / 100), 2)
    total_processing = processing_fee + gst_on_fee

    # Expected EMI (deterministic)
    expected_emi    = compute_emi(principal, annual_rate, tenure)
    total_expected  = round(expected_emi * tenure, 2) if expected_emi > 0 else 0.0
    total_stated    = round(stated_emi * tenure, 2) if stated_emi > 0 else 0.0

    # Effective interest rate
    effective_rate = 0.0
    if stated_emi > 0 and principal > 0 and tenure > 0:
        effective_rate = compute_effective_rate(principal, stated_emi, tenure)
    elif expected_emi > 0 and principal > 0 and tenure > 0:
        effective_rate = compute_effective_rate(principal, expected_emi, tenure)

    # EMI deviation
    emi_deviation = 0.0
    if expected_emi > 0 and stated_emi > 0:
        emi_deviation = round(abs(stated_emi - expected_emi) / expected_emi * 100, 4)

    # Penal stacking — applied only on overdue installment per RBI/2023-24/53
    penal_stacking_impact = 0.0
    if penal_rate > 0 and expected_emi > 0:
        monthly_penal_on_emi = (penal_rate / 12 / 100) * expected_emi
        penal_stacking_impact = round(monthly_penal_on_emi * PENAL_STACKING_MONTHS, 2)

    hidden_fee_impact = round(total_processing, 2)

    overcharge = compute_overcharge(
        total_stated, total_expected,
        processing_fee, processing_fee_pct,
        principal, gst_pct, loan_type,
    )

    emi_flag         = emi_deviation > 1.5
    apr_mismatch     = (extraction.apr > 0) and (abs(extraction.apr - effective_rate) > 2.0)
    repayment_mismatch = (
        total_stated > 0
        and total_expected > 0
        and abs(total_stated - total_expected) / total_expected > 0.02
    )

    # ── Build all plain English fields ────────────────────────────────────────
    deviation_verdict = _get_deviation_verdict(emi_deviation)

    final_stated_emi  = stated_emi if stated_emi > 0 else expected_emi
    final_total_stated = total_stated if total_stated > 0 else total_expected

    emi_plain_summary = _build_emi_plain_summary(
        expected_emi=expected_emi,
        stated_emi=final_stated_emi,
        deviation_pct=emi_deviation,
        deviation_verdict=deviation_verdict,
        tenure=tenure,
    )

    overcharge_plain = _build_overcharge_plain(
        overcharge=overcharge,
        tenure=tenure,
        stated_emi=final_stated_emi,
        expected_emi=expected_emi,
        processing_fee=processing_fee,
        principal=principal,
        deviation_verdict=deviation_verdict,
    )

    logger.info(
        f"EMI Analysis: expected=₹{expected_emi}, stated=₹{stated_emi}, "
        f"deviation={emi_deviation}% [{deviation_verdict}], overcharge=₹{overcharge}"
    )

    return EMIAnalysis(
        expected_emi=expected_emi,
        stated_emi=final_stated_emi,
        emi_deviation_percent=emi_deviation,
        total_expected_repayment=total_expected,
        total_stated_repayment=final_total_stated,
        effective_interest_rate=effective_rate,
        penal_stacking_impact=penal_stacking_impact,
        hidden_fee_impact=hidden_fee_impact,
        overcharge_estimate=overcharge,
        emi_flag=emi_flag,
        apr_mismatch=apr_mismatch,
        repayment_mismatch=repayment_mismatch,
        # ── Plain English fields ──────────────────────────────────────────────
        deviation_verdict=deviation_verdict,
        emi_plain_summary=emi_plain_summary,
        overcharge_plain=overcharge_plain,
    )
