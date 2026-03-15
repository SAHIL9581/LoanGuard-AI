import json
import httpx
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from app.config import get_settings
from app.models.schemas import LoanExtraction, EMIAnalysis, Violation, BehavioralAlert
from app.services.compliance_rag import build_compliance_context
from app.services.llm_utils import parse_json_payload


settings = get_settings()


# ── OpenAI Violation Prompt ────────────────────────────────────────────────────

VIOLATION_PROMPT = """You are an expert Indian banking law compliance officer. Analyze the loan agreement data and detect violations.

RBI COMPLIANCE CONTEXT:
{compliance_context}

LOAN AGREEMENT DATA:
{loan_data}

EMI ANALYSIS:
{emi_analysis}

Detect ALL violations and return a JSON array. Each violation MUST follow this exact schema:
{{
  "issue_type": "",
  "severity": "",
  "rule_triggered": "",
  "clause_reference": "",
  "financial_impact": 0,
  "confidence_score": 0.0,
  "detection_method": "AI_INFERRED",
  "plain_english": "",
  "what_this_means": "",
  "why_it_matters": "",
  "action_hint": ""
}}

PLAIN ENGLISH FIELD RULES:
- plain_english: ONE short sentence (max 15 words) that a teenager can read. No jargon. No RBI terms.
  Example: "Your bank charges more than the legal limit for a bounced payment."
- what_this_means: 2–3 sentences explaining what the problem is in simple words.
  Example: "When your EMI payment fails, your bank charges a 'bounce fee'. RBI says this fee cannot be more than ₹500 per instance. Your bank is charging ₹1,200 — more than double the legal limit."
- why_it_matters: 1–2 sentences on real-world impact to the borrower.
  Example: "If you ever miss a payment, you'll be charged ₹700 more than you legally should be. Over a 36-month loan, this can add up significantly."
- action_hint: One actionable step the borrower can take right now.
  Example: "Mention this overcharge in your Level 1 complaint letter and demand a refund of all excess bounce charges paid."

Return JSON: {{"violations": [...]}}

DETECTION RULES:
1.  GST misapplication on interest (should be on fees only) → HIGH
2.  Penal interest compounded into principal → CRITICAL
3.  Processing fee > 3% of principal → HIGH
4.  No KFS present → HIGH (RBI DOR.CRE.REC.66/2022-23)
5.  Bank discretion rate change clause → HIGH
6.  Floating rate without reset frequency disclosure → MEDIUM
7.  Recovery agent clause without borrower consent → HIGH
8.  EMI deviation > 1.5% from deterministic formula → CRITICAL
9.  APR not disclosed → HIGH (RBI KFS mandate)
10. Auto-debit mandate described as irrevocable → HIGH (NPCI guidelines)
11. Bounce charge > INR 500 per instance → MEDIUM
12. No grievance redressal mechanism → MEDIUM
13. Penal interest > 3% per month → HIGH
14. Multiple penalty stacking on same default event → CRITICAL
15. No cooling-off period → MEDIUM (RBI FPC Code)
16. Data sharing with marketing parties without explicit consent → HIGH (DPDP Act 2023)

Only include violations you are confident exist. Do NOT hallucinate. Return empty array if no violations found."""


# ── Plain English Fallback Map (for model violations missing plain fields) ────

_PLAIN_ENGLISH_FALLBACK: dict[str, dict] = {
    "missing key fact statement": {
        "plain_english": "Your bank never gave you the required 1-page loan summary.",
        "what_this_means": (
            "RBI law says every bank must give you a simple 1-page document called a "
            "Key Facts Statement (KFS) before you sign. It summarises your loan in plain "
            "language — interest rate, EMI, and all charges. Your bank skipped this entirely."
        ),
        "why_it_matters": (
            "Without the KFS, you may not have fully understood what you were agreeing to. "
            "This alone is enough to legally challenge the agreement."
        ),
        "action_hint": "Demand the KFS from your bank in writing. Use the Level 1 complaint letter below.",
    },
    "apr not disclosed": {
        "plain_english": "Your bank hid the true total cost of your loan.",
        "what_this_means": (
            "APR (Annual Percentage Rate) is the real interest rate that includes all fees — "
            "not just the basic rate. Your bank is legally required to tell you this number "
            "upfront. It was not disclosed anywhere in your agreement."
        ),
        "why_it_matters": (
            "Without the APR, you cannot compare loan offers fairly or know what you are "
            "truly paying. The hidden fees likely make your effective rate much higher than stated."
        ),
        "action_hint": "Ask your bank to provide the APR calculation in writing. This is mandatory under RBI KFS Guidelines.",
    },
    "emi overstatement": {
        "plain_english": "Your bank is charging you a higher monthly payment than the correct amount.",
        "what_this_means": (
            "Your EMI (monthly payment) can be calculated exactly using a standard formula based "
            "on your loan amount, interest rate, and tenure. The amount your bank stated is higher "
            "than what the formula gives — meaning you are overpaying every single month."
        ),
        "why_it_matters": (
            "This overcharge is mathematically proven. Every extra rupee you pay monthly adds up "
            "to a significant sum over the entire loan tenure."
        ),
        "action_hint": "This is a math-proven violation. Demand a corrected repayment schedule and refund of excess EMIs paid.",
    },
    "excessive processing fee": {
        "plain_english": "Your bank charged a processing fee higher than RBI allows.",
        "what_this_means": (
            "When you take a loan, banks charge a one-time 'processing fee' for paperwork. "
            "RBI says this cannot exceed 3% of your loan amount. Your bank charged more than "
            "that and deducted it from the money you received upfront."
        ),
        "why_it_matters": (
            "You received less money than you borrowed, but you are paying interest on the "
            "full amount. The excess fee is an illegal deduction from your loan."
        ),
        "action_hint": "Claim a refund of the excess processing fee in your complaint letter. Calculate: (your fee) minus (3% of loan amount).",
    },
    "penal interest compounded into principal": {
        "plain_english": "Bank is adding penalty charges INTO your loan balance, making your debt snowball.",
        "what_this_means": (
            "If you miss a payment, instead of just charging a flat penalty fee, your bank "
            "adds that penalty to your loan balance (principal). This means you start paying "
            "interest on the penalty too — your debt grows faster and faster, like a snowball rolling downhill."
        ),
        "why_it_matters": (
            "RBI explicitly banned this practice in 2023. It can trap borrowers in a cycle of "
            "growing debt that becomes impossible to repay. This is one of the most serious violations."
        ),
        "action_hint": "This is a CRITICAL violation. Mention RBI Circular RBI/2023-24/53 explicitly in all three escalation letters.",
    },
    "excessive penal interest rate": {
        "plain_english": "Your bank's late payment penalty rate is higher than what RBI permits.",
        "what_this_means": (
            "If you miss an EMI, your bank charges a 'penal interest' on the overdue amount. "
            "RBI says this penalty rate must be reasonable. Your bank's rate exceeds 3% per month "
            "(36% per year) — which is exploitative and non-compliant."
        ),
        "why_it_matters": (
            "Missing even one payment could trigger a penalty that rapidly inflates your outstanding "
            "balance. Combined with the compounding issue, this can quickly spiral out of control."
        ),
        "action_hint": "Demand the penal rate be reduced to a reasonable level. Cite RBI Fair Practice Code in your complaint.",
    },
    "excessive bounce charge": {
        "plain_english": "Your bank charges more than ₹500 for a bounced payment — that is illegal.",
        "what_this_means": (
            "A 'bounce charge' is a fee when your EMI payment fails (e.g., insufficient balance). "
            "RBI's payment system guidelines cap this at ₹500 per instance. "
            "Your bank is charging significantly more than this limit."
        ),
        "why_it_matters": (
            "If you ever have a payment failure, you will be overcharged immediately. "
            "Demand a refund of every excess bounce charge you have already paid."
        ),
        "action_hint": "List all bounced payment dates and calculate total excess charges paid. Include this amount in your refund demand.",
    },
    "irrevocable nach/ecs mandate": {
        "plain_english": "Your bank claims you can NEVER cancel the auto-debit from your account.",
        "what_this_means": (
            "Auto-debit (called NACH or ECS) lets the bank automatically pull your EMI from your "
            "bank account every month. Your agreement says this permission can never be cancelled — "
            "and that trying to cancel it counts as 'wilful default'. This is completely illegal."
        ),
        "why_it_matters": (
            "If the bank debits wrong amounts or extra fees, you would have no way to stop them. "
            "This puts your entire bank balance at the bank's mercy."
        ),
        "action_hint": "Write to your bank demanding written confirmation that NACH can be cancelled. NPCI guidelines guarantee this right.",
    },
    "unauthorised data sharing with marketing parties": {
        "plain_english": "Your bank is sharing your personal data with marketing companies without proper consent.",
        "what_this_means": (
            "Your agreement allows the bank to share your name, phone number, financial details, "
            "and even location data with third-party marketing companies. Under India's DPDP Act 2023, "
            "this requires your free, informed, and specific consent — not a buried clause in fine print."
        ),
        "why_it_matters": (
            "Your personal and financial data could be sold or used for targeted marketing without "
            "your knowledge. This is a privacy violation under Indian law."
        ),
        "action_hint": "Send a written notice to the bank withdrawing consent for data sharing with marketing parties, citing DPDP Act 2023.",
    },
    "no cooling-off period": {
        "plain_english": "Your bank gave you no time to change your mind after signing.",
        "what_this_means": (
            "A 'cooling-off period' is a window (usually 3 days) after signing where you can "
            "cancel the loan without penalty. RBI's Fair Practice Code says banks should offer "
            "this. Your agreement has no such clause."
        ),
        "why_it_matters": (
            "Without a cooling-off period, you were locked into the loan the moment you signed, "
            "even if you discovered problematic clauses immediately after."
        ),
        "action_hint": "Mention the missing cooling-off period in your complaint as evidence of non-compliance with RBI Fair Practice Code.",
    },
    "no grievance redressal mechanism": {
        "plain_english": "Your bank never told you how to file a complaint against them.",
        "what_this_means": (
            "Every loan agreement must include details of the bank's Grievance Redressal Officer "
            "(GRO) — a person you can formally complain to. RBI's Integrated Ombudsman Scheme 2021 "
            "makes this mandatory. Your agreement has no such information."
        ),
        "why_it_matters": (
            "Without a named GRO, the bank makes it harder for you to escalate issues officially. "
            "This is a deliberate barrier to your consumer rights."
        ),
        "action_hint": "Look up the bank's GRO on the RBI website or the bank's official site. File your Level 1 letter directly to that officer.",
    },
    "unilateral interest rate revision": {
        "plain_english": "Your bank can change your interest rate anytime without asking you.",
        "what_this_means": (
            "Your agreement says the bank can revise your interest rate at any time, with just "
            "an SMS or email notice. If you don't reply within 7 days, the new rate is automatically "
            "accepted. RBI law requires prior notice and borrower consent for rate changes."
        ),
        "why_it_matters": (
            "Your EMI and total repayment could increase significantly without your agreement. "
            "This clause effectively lets the bank change the deal after you've already signed."
        ),
        "action_hint": "Challenge any rate revision by sending a written objection within 7 days. Keep all SMS/email records as evidence.",
    },
    "recovery agent clause without borrower consent": {
        "plain_english": "Your bank can send debt collectors to your home and workplace without your permission.",
        "what_this_means": (
            "Your agreement allows the bank to send recovery agents (debt collectors) to your "
            "home, office, and even contact your family and employer if you miss payments. "
            "RBI guidelines require that recovery agents follow a strict code of conduct and "
            "cannot harass or intimidate borrowers."
        ),
        "why_it_matters": (
            "This clause is often used to pressure borrowers through embarrassment and harassment. "
            "Recovery agents harassing family members or employers is a violation of your rights."
        ),
        "action_hint": "If contacted by a recovery agent, ask for their ID and the bank's authorization letter. Report any harassment to RBI Ombudsman.",
    },
    "multiple penalty stacking": {
        "plain_english": "Your bank charges you several different penalties at once for missing ONE payment.",
        "what_this_means": (
            "When you miss a single EMI, your agreement triggers multiple charges simultaneously: "
            "penal interest, late payment fee per day, bounce charge, and capitalisation into principal. "
            "RBI guidelines say you cannot be penalised multiple times for the same default event."
        ),
        "why_it_matters": (
            "Missing one payment could instantly create a debt spiral with four different charges "
            "running at the same time. This is predatory and illegal under RBI rules."
        ),
        "action_hint": "Document every charge applied after a missed payment. List them all in your complaint as 'penalty stacking' — a CRITICAL violation.",
    },
    "gst misapplication on interest": {
        "plain_english": "Your bank is incorrectly applying GST (tax) to your interest payments.",
        "what_this_means": (
            "GST (Goods and Services Tax) is only applicable on fees and service charges — "
            "not on interest payments. If your bank is applying 18% GST on your monthly interest, "
            "they are overcharging you on every single EMI you pay."
        ),
        "why_it_matters": (
            "This quietly inflates your effective interest rate. Over a 3-year loan, the excess "
            "GST on interest can add up to thousands of rupees."
        ),
        "action_hint": "Request a full interest and fee breakup from the bank. If GST appears on interest line items, cite this in your complaint.",
    },
    "floating rate without reset frequency": {
        "plain_english": "Your loan rate can change but your bank hasn't said how often or by how much.",
        "what_this_means": (
            "A 'floating rate' loan means your interest rate can go up or down over time. "
            "RBI requires banks to clearly state when and how the rate will be reviewed. "
            "Your agreement is vague about this — giving the bank unlimited flexibility to change your rate."
        ),
        "why_it_matters": (
            "Without a defined reset frequency, you have no way to predict your future EMIs "
            "or total repayment amount. This makes financial planning impossible."
        ),
        "action_hint": "Ask the bank to provide a written schedule of rate reset dates and the benchmark they use for calculations.",
    },
}


def _get_plain_fields(issue_type: str, financial_impact: float = 0) -> dict:
    """
    Returns plain English fields for a given issue_type.
    Tries an exact match first, then a fuzzy keyword match.
    """
    key = issue_type.lower().strip()

    # Exact match
    if key in _PLAIN_ENGLISH_FALLBACK:
        return _PLAIN_ENGLISH_FALLBACK[key]

    # Fuzzy keyword match
    for map_key, fields in _PLAIN_ENGLISH_FALLBACK.items():
        if any(word in key for word in map_key.split() if len(word) > 4):
            return fields

    # Generic fallback — still readable
    return {
        "plain_english": f"Your bank may have violated an RBI rule: {issue_type}.",
        "what_this_means": (
            "Our system detected a potential compliance issue in your loan agreement. "
            "This was identified by AI analysis of the document text against RBI guidelines."
        ),
        "why_it_matters": (
            "Even if the financial impact is small, regulatory violations give you the right "
            "to challenge the agreement and demand corrections from your bank."
        ),
        "action_hint": "Mention this violation in your complaint letter and ask the bank to clarify their compliance with the relevant RBI circular.",
    }


# ── Deterministic Checks (no AI, purely rule-based) ───────────────────────────

def run_deterministic_checks(
    extraction: LoanExtraction,
    emi_analysis: EMIAnalysis,
) -> list[Violation]:
    """
    Fast, deterministic violation checks that run before OpenAI.
    These are mathematically provable — 100% confidence score.
    All plain English fields are populated directly here.
    """
    violations: list[Violation] = []

    def add(issue_type: str, severity: str, rule: str, clause: str, impact: float, confidence: float = 1.0):
        plain = _get_plain_fields(issue_type, impact)
        violations.append(Violation(
            issue_type=issue_type,
            severity=severity,
            rule_triggered=rule,
            clause_reference=clause,
            financial_impact=float(impact),
            confidence_score=confidence,
            detection_method="MATH_PROVEN" if confidence == 1.0 else "AI_INFERRED",
            plain_english=plain["plain_english"],
            what_this_means=plain["what_this_means"],
            why_it_matters=plain["why_it_matters"],
            action_hint=plain["action_hint"],
        ))

    # V1 — KFS missing
    if not extraction.kfs_present:
        add(
            "Missing Key Fact Statement",
            "HIGH",
            "RBI Circular DOR.CRE.REC.66/2022-23 — KFS mandatory for all retail loans",
            "Document header / pre-agreement disclosures",
            0,
            0.95,
        )

    # V2 — APR not disclosed
    if not extraction.apr_disclosed and extraction.principal > 0:
        add(
            "APR Not Disclosed",
            "HIGH",
            "RBI KFS Guidelines — Annual Percentage Rate must be prominently disclosed",
            "Loan Details section",
            0,
            0.95,
        )

    # V3 — EMI overstatement (mathematically proven)
    if emi_analysis.emi_flag and emi_analysis.emi_deviation_percent > 1.5:
        overcharge = (emi_analysis.stated_emi - emi_analysis.expected_emi) * extraction.tenure_months
        add(
            "EMI Overstatement",
            "CRITICAL",
            "Deterministic EMI formula: P×r(1+r)^n/((1+r)^n−1) — stated EMI exceeds computed",
            "Loan Details / EMI clause",
            max(overcharge, 0),
            1.0,
        )

    # V4 — Processing fee > 3%
    if extraction.processing_fee_percent > 3.0:
        excess_fee = ((extraction.processing_fee_percent - 3.0) / 100) * extraction.principal
        add(
            "Excessive Processing Fee",
            "HIGH",
            "RBI Fair Practice Code — processing fee should not exceed 3% of principal",
            "Fees and Charges section",
            excess_fee,
            1.0,
        )
    elif extraction.processing_fee > 0 and extraction.principal > 0:
        pct = extraction.processing_fee / extraction.principal * 100
        if pct > 3.0:
            add(
                "Excessive Processing Fee",
                "HIGH",
                "RBI Fair Practice Code — processing fee should not exceed 3% of principal",
                "Fees and Charges section",
                extraction.processing_fee - (0.03 * extraction.principal),
                1.0,
            )

    # V5 — Penal compounding into principal
    if extraction.penal_compounding:
        add(
            "Penal Interest Compounded into Principal",
            "CRITICAL",
            "RBI Circular RBI/2023-24/53 — penal charges shall not be capitalised",
            "Penal Interest / Default clause",
            emi_analysis.penal_stacking_impact,
            1.0,
        )

    # V6 — Penal rate > 36% per annum (3% per month)
    if extraction.penal_interest_rate > 36.0:
        add(
            "Excessive Penal Interest Rate",
            "HIGH",
            "RBI FPC Code — penal charges must be reasonable and non-exploitative",
            "Penal Interest clause",
            0,
            0.95,
        )

    # V7 — Bounce charge > 500
    if extraction.bounce_charge > 500:
        add(
            "Excessive Bounce Charge",
            "MEDIUM",
            "RBI Payment Systems — bounce charges should not exceed INR 500 per instance",
            "Fees and Charges section",
            extraction.bounce_charge - 500,
            1.0,
        )

    # V8 — Irrevocable NACH mandate
    if extraction.irrevocable_nach:
        add(
            "Irrevocable NACH/ECS Mandate",
            "HIGH",
            "NPCI NACH Guidelines — borrower retains right to cancel mandate with notice",
            "Repayment / Auto-debit section",
            0,
            0.95,
        )

    # V9 — Data sharing with marketing parties
    if extraction.data_sharing_consent:
        add(
            "Unauthorised Data Sharing with Marketing Parties",
            "HIGH",
            "DPDP Act 2023 — personal data cannot be shared with marketing entities without explicit consent",
            "Data Consent / Privacy section",
            0,
            0.90,
        )

    # V10 — No cooling-off period
    if not extraction.cooling_off_period_present and extraction.principal > 0:
        add(
            "No Cooling-Off Period",
            "MEDIUM",
            "RBI Fair Practice Code — borrowers must be given option to cancel within cooling-off period",
            "Loan Terms / Cancellation section",
            0,
            0.85,
        )

    # V11 — No grievance redressal
    if not extraction.grievance_redressal_present:
        add(
            "No Grievance Redressal Mechanism",
            "MEDIUM",
            "RBI Integrated Ombudsman Scheme 2021 — grievance mechanism mandatory in all agreements",
            "Grievance / Dispute section",
            0,
            0.90,
        )

    # V12 — Bank discretion on rate change
    if extraction.bank_discretion_clause and extraction.floating_rate:
        add(
            "Unilateral Interest Rate Revision",
            "HIGH",
            "RBI Circular DBOD.No.Dir.BC.56/13.03.00/2010-11 — rate changes require prior notice and borrower consent",
            "Interest Rate Reset clause",
            0,
            0.90,
        )

    # V13 — Recovery agent without consent
    if extraction.recovery_agent_clause:
        add(
            "Recovery Agent Clause Without Borrower Consent",
            "HIGH",
            "RBI Guidelines on Recovery Agents — agents must follow a code of conduct; borrower consent required",
            "Default and Recovery section",
            0,
            0.90,
        )

    logger.info(f"Deterministic checks found {len(violations)} violations")
    return violations


# ── OpenAI-Based Violation Detection ──────────────────────────────────────────

@retry(
    stop=stop_after_attempt(settings.openai_retries),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError)),
)
async def call_openai_violations(prompt: str) -> list:
    payload = {
        "model": settings.openai_model,
        "messages": [
            {
                "role": "system",
                "content": "You are a precise Indian banking compliance analyzer. Return only valid JSON.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": settings.openai_temperature,
        "max_tokens": settings.openai_max_tokens,
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
            raise ValueError("Violation response was not a JSON object")
        return parsed.get("violations", [])


async def detect_violations(
    extraction: LoanExtraction,
    emi_analysis: EMIAnalysis,
) -> list[Violation]:
    """
    Full violation detection pipeline:
      1. Run deterministic checks (instant, 100% confidence, plain English populated)
    2. Run OpenAI checks (catches pattern-based violations, also returns plain English)
      3. Deduplicate and merge results
    """
    # Stage A: deterministic (always runs, even if OpenAI fails)
    deterministic_violations = run_deterministic_checks(extraction, emi_analysis)

    # Stage B: OpenAI violations
    openai_violations: list[Violation] = []
    try:
        query = (
            f"{extraction.loan_type} {extraction.lender_name} "
            f"{extraction.interest_rate}% interest "
            f"processing fee {extraction.processing_fee}"
        )
        compliance_context = build_compliance_context(query)

        loan_data = {
            "principal": extraction.principal,
            "interest_rate": extraction.interest_rate,
            "apr": extraction.apr,
            "emi_stated": extraction.emi_stated,
            "tenure_months": extraction.tenure_months,
            "processing_fee": extraction.processing_fee,
            "processing_fee_percent": extraction.processing_fee_percent,
            "penal_interest_rate": extraction.penal_interest_rate,
            "gst_percent": extraction.gst_percent,
            "bounce_charge": extraction.bounce_charge,
            "foreclosure_clause": extraction.foreclosure_clause,
            "auto_debit_consent": extraction.auto_debit_consent,
            "recovery_agent_clause": extraction.recovery_agent_clause,
            "floating_rate": extraction.floating_rate,
            "bank_discretion_clause": extraction.bank_discretion_clause,
            "kfs_present": extraction.kfs_present,
            "apr_disclosed": extraction.apr_disclosed,
            "penal_compounding": extraction.penal_compounding,
            "irrevocable_nach": extraction.irrevocable_nach,
            "data_sharing_consent": extraction.data_sharing_consent,
            "cooling_off_period_present": extraction.cooling_off_period_present,
            "grievance_redressal_present": extraction.grievance_redressal_present,
            "loan_type": extraction.loan_type,
            "lender_name": extraction.lender_name,
        }
        emi_data = {
            "expected_emi": emi_analysis.expected_emi,
            "stated_emi": emi_analysis.stated_emi,
            "emi_deviation_percent": emi_analysis.emi_deviation_percent,
            "overcharge_estimate": emi_analysis.overcharge_estimate,
            "emi_flag": emi_analysis.emi_flag,
            "apr_mismatch": emi_analysis.apr_mismatch,
            "penal_stacking_impact": emi_analysis.penal_stacking_impact,
        }
        prompt = VIOLATION_PROMPT.format(
            compliance_context=compliance_context[:3000],
            loan_data=json.dumps(loan_data, indent=2),
            emi_analysis=json.dumps(emi_data, indent=2),
        )
        raw = await call_openai_violations(prompt)

        for v in raw:
            try:
                issue_type = v.get("issue_type", "Unknown")

                # Use model-returned plain fields if non-empty, else use fallback map
                openai_plain = v.get("plain_english", "").strip()
                openai_means = v.get("what_this_means", "").strip()
                openai_matters = v.get("why_it_matters", "").strip()
                openai_hint = v.get("action_hint", "").strip()

                fallback = _get_plain_fields(issue_type, float(v.get("financial_impact", 0)))

                openai_violations.append(Violation(
                    issue_type=issue_type,
                    severity=v.get("severity", "MEDIUM"),
                    rule_triggered=v.get("rule_triggered", ""),
                    clause_reference=v.get("clause_reference", ""),
                    financial_impact=float(v.get("financial_impact", 0)),
                    confidence_score=float(v.get("confidence_score", 0.5)),
                    detection_method="AI_INFERRED",
                    plain_english=openai_plain or fallback["plain_english"],
                    what_this_means=openai_means or fallback["what_this_means"],
                    why_it_matters=openai_matters or fallback["why_it_matters"],
                    action_hint=openai_hint or fallback["action_hint"],
                ))
            except Exception as ve:
                logger.warning(f"Skipping malformed OpenAI violation: {ve}")

        logger.info(f"OpenAI detected {len(openai_violations)} additional violations")

    except Exception as e:
        logger.error(f"OpenAI violation detection failed (using deterministic only): {e}")

    # Stage C: Deduplicate — skip model violations already covered deterministically
    deterministic_types = {v.issue_type.lower() for v in deterministic_violations}
    unique_openai = [
        v for v in openai_violations
        if v.issue_type.lower() not in deterministic_types
    ]

    all_violations = deterministic_violations + unique_openai
    logger.info(
        f"Total violations: {len(all_violations)} "
        f"({len(deterministic_violations)} deterministic + {len(unique_openai)} from OpenAI)"
    )
    return all_violations


# ── Behavioral Analysis ────────────────────────────────────────────────────────

BEHAVIORAL_KEYWORDS = {
    "threat_language": [
        "legal action", "criminal complaint", "arrest", "police", "FIR",
        "court proceedings", "seize", "attachment", "property seizure",
        "cibil destroy", "credit score destroy", "without court order",
        "criminal complaint", "section 138", "section 420",
    ],
    "aggressive_tone": [
        "immediate payment", "failure to pay will result", "dire consequences",
        "last notice", "final warning", "no further notice will be given",
        "compel payment", "this is a final warning",
    ],
    "consent_misuse": [
        "deemed consent", "implied consent", "silence implies",
        "unconditional authority", "irrevocable mandate",
        "without further notice", "automatic renewal",
        "silence on the part of the borrower",
    ],
    "data_abuse": [
        "share with third parties", "marketing partners", "sell data",
        "contact references without notice", "access contacts",
        "access location", "irrevocable", "third-party marketing",
    ],
}

# Maps each behavioral flag to a plain English explanation
_BEHAVIORAL_PLAIN: dict[str, str] = {
    "threat_language": (
        "Agreement uses threats like 'criminal case will be filed' or 'property will be seized' "
        "to pressure you — these threats are not automatically enforceable and may violate RBI's "
        "recovery guidelines."
    ),
    "aggressive_tone": (
        "Agreement uses urgent, intimidating language like 'FINAL WARNING' or 'no further notice "
        "will be given' — this is designed to panic you into paying without questioning the charges."
    ),
    "consent_misuse": (
        "Agreement claims your silence or inaction counts as consent to new terms — this is "
        "legally invalid. You must explicitly agree to any changes in writing."
    ),
    "data_abuse": (
        "Bank claims the right to share your personal data with marketing companies and access "
        "your phone contacts and location — you did NOT have to agree to this for the loan."
    ),
}


def detect_behavioral_issues(raw_text: str) -> BehavioralAlert:
    """Detect threatening language, consent misuse, and data abuse in document text."""
    text_lower = raw_text.lower()

    threat_found     = any(kw in text_lower for kw in BEHAVIORAL_KEYWORDS["threat_language"])
    aggressive_found = any(kw in text_lower for kw in BEHAVIORAL_KEYWORDS["aggressive_tone"])
    consent_found    = any(kw in text_lower for kw in BEHAVIORAL_KEYWORDS["consent_misuse"])
    data_found       = any(kw in text_lower for kw in BEHAVIORAL_KEYWORDS["data_abuse"])

    # Build legacy alert string (kept for backward compatibility)
    alert_parts = []
    if threat_found:    alert_parts.append("threatening recovery language")
    if aggressive_found: alert_parts.append("aggressive collection tone")
    if consent_found:   alert_parts.append("implied/irrevocable consent clauses")
    if data_found:      alert_parts.append("potential data misuse clauses")

    consumer_alert = (
        "⚠️ CONSUMER RISK ALERT: " + ", ".join(alert_parts)
        if alert_parts
        else "No significant behavioral risks detected"
    )

    # Build plain English flags list — only include detected flags
    flags_plain: list[str] = []
    if threat_found:     flags_plain.append(_BEHAVIORAL_PLAIN["threat_language"])
    if aggressive_found: flags_plain.append(_BEHAVIORAL_PLAIN["aggressive_tone"])
    if consent_found:    flags_plain.append(_BEHAVIORAL_PLAIN["consent_misuse"])
    if data_found:       flags_plain.append(_BEHAVIORAL_PLAIN["data_abuse"])

    # Overall plain warning message
    if flags_plain:
        plain_warning = (
            "Your loan agreement uses manipulative and potentially illegal language. "
            "It tries to scare you with threats, claims rights over your personal data, "
            "and treats your silence as agreement to new terms. None of these clauses "
            "override your legal rights as a borrower."
        )
    else:
        plain_warning = "No threatening or manipulative language was found in your agreement."

    return BehavioralAlert(
        threat_language_detected=threat_found,
        aggressive_tone_detected=aggressive_found,
        consent_misuse_detected=consent_found,
        data_abuse_clause_detected=data_found,
        consumer_risk_alert=consumer_alert,
        plain_warning=plain_warning,
        flags_plain=flags_plain,
    )
