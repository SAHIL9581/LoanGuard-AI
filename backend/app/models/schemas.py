from pydantic import BaseModel
from typing import Optional, List


class LoanExtraction(BaseModel):
    principal: float = 0.0
    interest_rate: float = 0.0
    apr: float = 0.0
    emi_stated: float = 0.0
    tenure_months: int = 0
    processing_fee: float = 0.0
    processing_fee_percent: float = 0.0
    penal_interest_rate: float = 0.0
    gst_percent: float = 18.0
    bounce_charge: float = 0.0
    moratorium_period_months: float = 0.0
    insurance_premium: float = 0.0
    foreclosure_clause: bool = False
    rate_reset_clause: bool = False
    auto_debit_consent: bool = False
    recovery_agent_clause: bool = False
    floating_rate: bool = False
    bank_discretion_clause: bool = False
    kfs_present: bool = False
    grievance_redressal_present: bool = False
    cooling_off_period_present: bool = False
    apr_disclosed: bool = False
    penal_compounding: bool = False
    irrevocable_nach: bool = False
    data_sharing_consent: bool = False
    loan_type: str = "Personal Loan"
    lender_name: str = ""
    borrower_name: str = ""
    agreement_date: str = ""
    raw_text_excerpt: str = ""
    full_extracted_text: str = ""


class EMIAnalysis(BaseModel):
    expected_emi: float
    stated_emi: float
    emi_deviation_percent: float
    total_expected_repayment: float
    total_stated_repayment: float
    effective_interest_rate: float
    penal_stacking_impact: float
    hidden_fee_impact: float
    overcharge_estimate: float
    emi_flag: bool
    apr_mismatch: bool
    repayment_mismatch: bool

    # ── Plain English Additions ──────────────────────────────────────────
    emi_plain_summary: str = ""
    # e.g. "Your bank says you pay ₹19,800/month but the correct amount
    #       is ₹19,616. You're being overcharged ₹184 every month."

    overcharge_plain: str = ""
    # e.g. "Over 36 months, this small difference adds up to ₹6,624
    #       extra that you should NOT be paying."

    deviation_verdict: str = "OK"
    # "OK" | "MINOR" | "SIGNIFICANT" | "CRITICAL"
    # Human label so frontend doesn't have to compute this itself


class Violation(BaseModel):
    issue_type: str
    severity: str               # LOW | MEDIUM | HIGH | CRITICAL
    rule_triggered: str
    clause_reference: str
    financial_impact: float
    confidence_score: float
    detection_method: str = "AI_INFERRED"
    # "MATH_PROVEN" | "AI_INFERRED" — replaces the raw confidence badge

    # ── Plain English Additions ──────────────────────────────────────────
    plain_english: str = ""
    # ONE sentence, jargon-free title.
    # e.g. "Bank says you can NEVER cancel the auto-debit from your account."

    what_this_means: str = ""
    # 2–3 sentences explaining the violation to a layperson.
    # e.g. "An auto-debit (NACH) lets the bank pull money from your account
    #       automatically every month. Your agreement says this permission
    #       can never be taken back — that's illegal. You always have the
    #       right to cancel it by giving written notice to your bank."

    why_it_matters: str = ""
    # 1–2 sentences on real-world impact.
    # e.g. "If the bank debits wrong amounts or extra fees, you cannot stop
    #       them. This puts your entire bank balance at risk."

    action_hint: str = ""
    # Short actionable step for the user.
    # e.g. "Write to your bank demanding confirmation that NACH can be
    #       cancelled — use the Level 1 complaint letter below."


class EscalationLevel(BaseModel):
    level: int
    title: str
    recipient: str
    subject: str
    body: str
    rbi_references: List[str]

    # ── Plain English Additions ──────────────────────────────────────────
    level_plain_title: str = ""
    # e.g. "Step 1 — Complain directly to your bank first"

    when_to_use: str = ""
    # e.g. "Send this letter first. The bank has 30 days to respond.
    #       If they ignore you or reject the complaint, move to Step 2."

    expected_outcome: str = ""
    # e.g. "Bank acknowledges the complaint and begins an internal review."


class RiskScore(BaseModel):
    total_score: float
    emi_deviation_score: float
    hidden_fee_score: float
    rbi_violation_score: float
    penal_stacking_score: float
    transparency_score: float
    ambiguity_score: float
    behavioral_risk_score: float = 0.0      # was missing from original model
    risk_category: str                       # LOW | MEDIUM | HIGH | CRITICAL
    appeal_success_probability: float

    # ── Plain English Additions ──────────────────────────────────────────
    risk_category_plain: str = ""
    # e.g. "HIGH RISK — This loan agreement has serious problems"

    risk_summary_plain: str = ""
    # 2–3 sentence plain summary of the overall risk.
    # e.g. "Your loan agreement breaks 17 RBI rules and tries to
    #       charge you ₹15,459 more than allowed. The bank uses
    #       threatening language and has clauses that let them take
    #       money from your account without asking. You have a very
    #       strong case if you file a complaint."

    score_breakdown_plain: List[str] = []
    # Each item is a plain label for one score component, in order:
    # ["Your EMI is slightly higher than it should be",
    #  "Several hidden fees were found",
    #  "Bank broke multiple RBI rules",
    #  "Penalty charges are stacked on top of each other",
    #  "Bank is not transparent about the true cost",
    #  "Agreement has many vague/ambiguous clauses",
    #  "Agreement uses threatening or manipulative language"]

    appeal_plain: str = ""
    # e.g. "You have a 95% chance of winning if you file a complaint
    #       with the RBI Ombudsman — that's extremely high."


class BehavioralAlert(BaseModel):
    threat_language_detected: bool
    aggressive_tone_detected: bool
    consent_misuse_detected: bool
    data_abuse_clause_detected: bool
    consumer_risk_alert: str

    # ── Plain English Additions ──────────────────────────────────────────
    plain_warning: str = ""
    # e.g. "Your loan agreement uses threatening and illegal language
    #       to scare you. It also claims the right to access your phone
    #       contacts and location — that is not allowed without your
    #       free and informed consent."

    flags_plain: List[str] = []
    # Each flag translated to plain English, e.g.:
    # ["Agreement uses threats like 'criminal case will be filed' to
    #   pressure you into paying — this is not automatically true",
    #  "Bank claims it can share your personal data with marketing
    #   companies — you did NOT have to agree to this"]


class KeyAction(BaseModel):
    """
    A single recommended action the borrower should take.
    Shown as a checklist on the report.
    """
    priority: int               # 1 = most urgent
    action: str                 # Plain English action title
    description: str            # 1–2 sentence explanation
    related_violation: str = "" # issue_type of the linked violation, if any


class AuditResponse(BaseModel):
    extraction: LoanExtraction
    emi_analysis: EMIAnalysis
    violations: List[Violation]
    escalations: List[EscalationLevel]
    risk_score: RiskScore
    behavioral_alert: BehavioralAlert
    compliance_summary: str
    confidence_overall: float
    document_completeness: float = 0.0
    processing_time_ms: float

    # ── Plain English Additions ──────────────────────────────────────────
    plain_summary: str = ""
    # The single most important paragraph shown at the top of the report.
    # Written like a friend explaining the situation:
    # "We checked your loan agreement with QuickCash Finance and found
    #  17 problems. The most serious one: the bank is adding penalty
    #  fees directly onto your loan balance, which makes your debt
    #  grow faster than it should. On top of that, you're being
    #  overcharged ₹15,459. The good news: you have a 95% chance of
    #  winning a complaint against them."

    key_actions: List[KeyAction] = []
    # Ordered list of "What should I do now?" steps for the borrower.

    critical_violations_plain: List[str] = []
    # Only CRITICAL severity violations, each as a single plain sentence.
    # Shown prominently at the top of the violations section.

    document_completeness_plain: str = ""
    # e.g. "The bank did not provide a Key Facts Statement (KFS) —
    #       a simple 1-page summary of your loan that they are legally
    #       required to give you before you sign."

    low_confidence_warning: Optional[str] = None
    # Shown as a warning banner if document quality was too low to be reliable.


class AuditRequest(BaseModel):
    file_base64: Optional[str] = None
    raw_text: Optional[str] = None
