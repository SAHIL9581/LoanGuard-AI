import json
import httpx
from io import BytesIO
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.lib.colors import HexColor
from app.config import get_settings
from app.models.schemas import LoanExtraction, EMIAnalysis, Violation, EscalationLevel
from app.services.llm_utils import parse_json_payload


settings = get_settings()


# ── Prompt ─────────────────────────────────────────────────────────────────────

ESCALATION_PROMPT = """You are an expert Indian consumer rights lawyer. Generate formal escalation letters for loan agreement violations.

LOAN DETAILS:
{loan_data}

EMI VIOLATIONS:
{emi_data}

DETECTED VIOLATIONS:
{violations_data}

Generate exactly 3 escalation levels as JSON:
{{
  "escalations": [
    {{
      "level": 1,
      "title": "Bank/NBFC Complaint Email",
      "recipient": "Grievance Redressal Officer, {lender_name}",
      "subject": "",
      "body": "",
      "rbi_references": [""],
      "level_plain_title": "Step 1 — Complain directly to your bank first",
      "when_to_use": "Send this letter first as your initial formal complaint. The bank has 30 days to respond. If they ignore you or reject the complaint, move to Step 2.",
      "expected_outcome": "Bank acknowledges the complaint and begins an internal review. You should receive a written response within 30 days."
    }},
    {{
      "level": 2,
      "title": "Nodal Officer Escalation",
      "recipient": "Nodal Officer, {lender_name}",
      "subject": "",
      "body": "",
      "rbi_references": [""],
      "level_plain_title": "Step 2 — Escalate to the bank's senior complaint officer",
      "when_to_use": "Use this letter only if Level 1 failed — either no response in 30 days or they rejected your complaint. The Nodal Officer is senior to the GRO and has more authority.",
      "expected_outcome": "Nodal Officer reviews the escalation and may override the GRO's decision. Response typically within 15 days."
    }},
    {{
      "level": 3,
      "title": "RBI Integrated Ombudsman Complaint",
      "recipient": "The Banking Ombudsman, Reserve Bank of India",
      "subject": "Complaint against {lender_name} - Unfair Loan Practices",
      "body": "",
      "rbi_references": ["RBI/2021-22/117", ""],
      "level_plain_title": "Step 3 — File a complaint with RBI (the final authority)",
      "when_to_use": "Use this only after both Level 1 and Level 2 have failed or if 30 days have passed with no satisfactory response. RBI is the regulator and can impose penalties on the bank.",
      "expected_outcome": "RBI Ombudsman investigates and can order the bank to refund overcharges, correct violations, and pay compensation. This is a binding decision."
    }}
  ]
}}

RULES FOR PLAIN ENGLISH FIELDS:
- level_plain_title: A single short sentence (max 12 words) in simple language. No formal tone.
  Example: "Step 1 — Complain directly to your bank first"
- when_to_use: 2–3 sentences explaining WHEN and WHY to send this letter. Timeline matters.
  Example: "Send this letter first as your initial formal complaint. The bank has 30 days to respond. If they ignore you or reject the complaint, move to Step 2."
- expected_outcome: 1–2 sentences on what will likely happen after sending this letter.
  Example: "Bank acknowledges the complaint and begins an internal review. You should receive a written response within 30 days."

LETTER BODY RULES:
- Each letter must cite specific RBI circulars from the violations data
- Include overcharge amount and refund demand where applicable
- Professional formal tone throughout
- Do NOT hallucinate case numbers or dates
- Reference [https://cms.rbi.org.in](https://cms.rbi.org.in) in Level 3 body"""


# ── OpenAI Call ────────────────────────────────────────────────────────────────

@retry(
    stop=stop_after_attempt(settings.openai_retries),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError)),
)
async def call_openai_escalations(prompt: str) -> list:
    payload = {
        "model": settings.openai_model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are an Indian consumer rights lawyer. "
                    "Generate formal complaint letters with plain English guidance. "
                    "Return only valid JSON."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.15,
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
            raise ValueError("Escalation response was not a JSON object")
        return parsed.get("escalations", [])


# ── Plain English Fallback Data ────────────────────────────────────────────────

_LEVEL_PLAIN_DEFAULTS = {
    1: {
        "level_plain_title": "Step 1 — Complain directly to your bank first",
        "when_to_use": (
            "Send this letter first as your initial formal complaint. "
            "The bank has 30 days to respond under RBI rules. "
            "If they ignore you or reject the complaint without valid reason, move to Step 2."
        ),
        "expected_outcome": (
            "Bank acknowledges the complaint and begins an internal review. "
            "You should receive a written response within 30 days explaining their decision."
        ),
    },
    2: {
        "level_plain_title": "Step 2 — Escalate to the bank's senior complaint officer",
        "when_to_use": (
            "Use this letter only if Level 1 failed — either no response in 30 days "
            "or they rejected your complaint. The Nodal Officer is senior to the "
            "Grievance Redressal Officer and has more authority to override decisions."
        ),
        "expected_outcome": (
            "Nodal Officer reviews the escalation and may override the previous rejection. "
            "Response typically within 15 days. If still unsatisfied, proceed to RBI."
        ),
    },
    3: {
        "level_plain_title": "Step 3 — File a complaint with RBI (the final authority)",
        "when_to_use": (
            "Use this only after both Level 1 and Level 2 have failed or if 30 days have "
            "passed with no satisfactory response. RBI is the banking regulator and has "
            "the power to impose penalties on the bank for non-compliance."
        ),
        "expected_outcome": (
            "RBI Ombudsman investigates the complaint independently and can order the bank "
            "to refund overcharges, correct violations, and pay compensation up to ₹20 lakhs. "
            "The Ombudsman's decision is binding on the bank."
        ),
    },
}


# ── Fallback Escalations ───────────────────────────────────────────────────────

def _build_fallback_escalations(
    extraction: LoanExtraction,
    emi_analysis: EMIAnalysis,
    violations: list[Violation],
) -> list[EscalationLevel]:
    """
    Returns 3 hardcoded but populated escalation letters when OpenAI fails.
    Ensures the pipeline never returns an empty escalation list.
    All plain English fields are populated using fallback defaults.
    """
    lender = extraction.lender_name or "the Lender"
    borrower = extraction.borrower_name or "the Borrower"
    overcharge = f"₹{emi_analysis.overcharge_estimate:,.0f}"
    
    # Build violation summary using plain English when available
    violation_items = []
    for v in violations[:5]:
        if hasattr(v, 'plain_english') and v.plain_english:
            violation_items.append(f"{v.plain_english} ({v.severity})")
        else:
            violation_items.append(f"{v.issue_type} ({v.severity})")
    
    violation_summary = "; ".join(violation_items) or "multiple regulatory violations"

    # Collect all unique RBI references from violations
    rbi_refs = []
    for v in violations:
        if v.rule_triggered and "RBI" in v.rule_triggered:
            # Extract just the circular part
            parts = v.rule_triggered.split("—")
            if parts:
                ref = parts[0].strip()
                if ref not in rbi_refs:
                    rbi_refs.append(ref)
    
    if not rbi_refs:
        rbi_refs = ["RBI Fair Practice Code", "RBI/2023-24/53"]

    return [
        EscalationLevel(
            level=1,
            title="Bank/NBFC Complaint Email",
            recipient=f"Grievance Redressal Officer, {lender}",
            subject=f"Formal Complaint: Unfair Loan Practices in Agreement — {borrower}",
            body=(
                f"Dear Sir/Madam,\n\n"
                f"I, {borrower}, write to formally lodge a complaint regarding violations "
                f"detected in my loan agreement with {lender}. "
                f"The following violations were identified through a detailed compliance review:\n\n"
                f"{violation_summary}\n\n"
                f"Estimated total overcharge: {overcharge}.\n\n"
                f"I request immediate rectification of these violations and a refund of all "
                f"overcharged amounts within 30 days of receipt of this letter. "
                f"I also request a revised loan statement reflecting the corrected terms.\n\n"
                f"If this matter is not resolved satisfactorily within the stipulated timeframe, "
                f"I will escalate this complaint to the Nodal Officer and subsequently to the "
                f"RBI Integrated Ombudsman.\n\n"
                f"I look forward to your prompt response.\n\n"
                f"Yours faithfully,\n{borrower}"
            ),
            rbi_references=rbi_refs[:3],
            level_plain_title=_LEVEL_PLAIN_DEFAULTS[1]["level_plain_title"],
            when_to_use=_LEVEL_PLAIN_DEFAULTS[1]["when_to_use"],
            expected_outcome=_LEVEL_PLAIN_DEFAULTS[1]["expected_outcome"],
        ),
        EscalationLevel(
            level=2,
            title="Nodal Officer Escalation",
            recipient=f"Nodal Officer, {lender}",
            subject=f"Escalation: Unresolved Complaint — Loan Agreement Violations — {borrower}",
            body=(
                f"Dear Nodal Officer,\n\n"
                f"I refer to my complaint dated [DATE OF LEVEL 1 LETTER] to the Grievance "
                f"Redressal Officer of {lender} regarding serious violations in my loan agreement.\n\n"
                f"Violations identified: {violation_summary}\n\n"
                f"Despite the 30-day deadline mandated under RBI's Integrated Grievance Redressal "
                f"Mechanism, my complaint remains [unresolved / inadequately addressed / unanswered].\n\n"
                f"Estimated financial impact: {overcharge}.\n\n"
                f"I hereby escalate this matter to your office and request your urgent intervention. "
                f"Under RBI guidelines, I expect a resolution within 15 days of receipt of this letter.\n\n"
                f"Failing satisfactory resolution, I will be compelled to file a formal complaint "
                f"with the RBI Integrated Ombudsman.\n\n"
                f"Yours faithfully,\n{borrower}"
            ),
            rbi_references=[
                "RBI Integrated Ombudsman Scheme 2021",
                "RBI/2021-22/117",
            ] + rbi_refs[:2],
            level_plain_title=_LEVEL_PLAIN_DEFAULTS[2]["level_plain_title"],
            when_to_use=_LEVEL_PLAIN_DEFAULTS[2]["when_to_use"],
            expected_outcome=_LEVEL_PLAIN_DEFAULTS[2]["expected_outcome"],
        ),
        EscalationLevel(
            level=3,
            title="RBI Integrated Ombudsman Complaint",
            recipient="The Banking Ombudsman, Reserve Bank of India",
            subject=f"Complaint against {lender} — Unfair Loan Practices and Non-Compliance",
            body=(
                f"Dear Banking Ombudsman,\n\n"
                f"I, {borrower}, hereby file a formal complaint against {lender} for multiple "
                f"violations of RBI guidelines in my loan agreement.\n\n"
                f"Violations detected: {violation_summary}\n\n"
                f"Estimated total overcharge: {overcharge}.\n\n"
                f"I have exhausted the internal grievance redressal mechanism:\n"
                f"• Level 1: Complaint to Grievance Redressal Officer on [DATE] — "
                f"[no response / inadequate response]\n"
                f"• Level 2: Escalation to Nodal Officer on [DATE] — [no resolution / rejected]\n\n"
                f"Under the RBI Integrated Ombudsman Scheme 2021, I request your intervention "
                f"to ensure compliance with RBI guidelines and award appropriate relief, including:\n"
                f"1. Full refund of overcharged amounts ({overcharge})\n"
                f"2. Correction of all non-compliant clauses in the agreement\n"
                f"3. Compensation for financial loss and mental harassment\n\n"
                f"Supporting documents and evidence are attached. "
                f"Complaint may be filed online at https://cms.rbi.org.in\n\n"
                f"Yours faithfully,\n{borrower}"
            ),
            rbi_references=[
                "RBI Integrated Ombudsman Scheme 2021",
                "RBI/2021-22/117",
                "RBI Fair Practice Code",
            ] + rbi_refs[:3],
            level_plain_title=_LEVEL_PLAIN_DEFAULTS[3]["level_plain_title"],
            when_to_use=_LEVEL_PLAIN_DEFAULTS[3]["when_to_use"],
            expected_outcome=_LEVEL_PLAIN_DEFAULTS[3]["expected_outcome"],
        ),
    ]


# ── Main Generator ─────────────────────────────────────────────────────────────

async def generate_escalations(
    extraction: LoanExtraction,
    emi_analysis: EMIAnalysis,
    violations: list[Violation],
) -> list[EscalationLevel]:
    """Generate multi-level escalation letters via OpenAI, with hardcoded fallback."""

    loan_data = {
        "principal": extraction.principal,
        "interest_rate": extraction.interest_rate,
        "lender": extraction.lender_name,
        "borrower": extraction.borrower_name,
        "loan_type": extraction.loan_type,
        "tenure_months": extraction.tenure_months,
        "processing_fee": extraction.processing_fee,
        "apr": extraction.apr,
    }
    emi_data = {
        "expected_emi": emi_analysis.expected_emi,
        "stated_emi": emi_analysis.stated_emi,
        "emi_deviation": f"{emi_analysis.emi_deviation_percent:.4f}%",
        "overcharge_estimate": f"₹{emi_analysis.overcharge_estimate:,.0f}",
        "penal_impact": emi_analysis.penal_stacking_impact,
    }

    # Use plain_english field if available, else fall back to issue_type
    violations_data = [
        {
            "issue": v.plain_english if hasattr(v, 'plain_english') and v.plain_english else v.issue_type,
            "severity": v.severity,
            "rule": v.rule_triggered,
            "clause": v.clause_reference,
            "impact": v.financial_impact,
            "confidence": v.confidence_score,
        }
        for v in violations[:10]
    ]

    prompt = ESCALATION_PROMPT.format(
        loan_data=json.dumps(loan_data, indent=2),
        emi_data=json.dumps(emi_data, indent=2),
        violations_data=json.dumps(violations_data, indent=2),
        lender_name=extraction.lender_name or "the Lender",
    )

    try:
        raw_escalations = await call_openai_escalations(prompt)
        escalations = []
        
        for e in raw_escalations:
            try:
                level_num = int(e.get("level", 1))
                
                # Use model-returned plain fields if non-empty, else use defaults
                openai_plain_title = e.get("level_plain_title", "").strip()
                openai_when_to_use = e.get("when_to_use", "").strip()
                openai_expected = e.get("expected_outcome", "").strip()
                
                fallback = _LEVEL_PLAIN_DEFAULTS.get(level_num, _LEVEL_PLAIN_DEFAULTS[1])
                
                escalations.append(EscalationLevel(
                    level=level_num,
                    title=e.get("title", ""),
                    recipient=e.get("recipient", ""),
                    subject=e.get("subject", ""),
                    body=e.get("body", ""),
                    rbi_references=e.get("rbi_references", []),
                    level_plain_title=openai_plain_title or fallback["level_plain_title"],
                    when_to_use=openai_when_to_use or fallback["when_to_use"],
                    expected_outcome=openai_expected or fallback["expected_outcome"],
                ))
            except Exception as ee:
                logger.warning(f"Skipping malformed escalation level: {ee}")

        if not escalations:
            logger.warning("OpenAI returned 0 escalations; using fallback")
            return _build_fallback_escalations(extraction, emi_analysis, violations)

        logger.info(f"Generated {len(escalations)} escalation levels")
        return escalations

    except Exception as e:
        logger.error(f"Escalation generation failed: {e} — using fallback")
        return _build_fallback_escalations(extraction, emi_analysis, violations)


# ── PDF Generator ──────────────────────────────────────────────────────────────

def generate_escalation_pdf(
    escalations: list[EscalationLevel],
    extraction: LoanExtraction,
) -> bytes:
    """Generate a downloadable PDF of all escalation letters with plain English guidance."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=inch, leftMargin=inch,
        topMargin=inch, bottomMargin=inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle', parent=styles['Title'],
        fontSize=16, textColor=HexColor('#1a1a2e'), spaceAfter=12,
    )
    heading_style = ParagraphStyle(
        'CustomHeading', parent=styles['Heading2'],
        fontSize=12, textColor=HexColor('#16213e'), spaceAfter=6,
    )
    body_style = ParagraphStyle(
        'CustomBody', parent=styles['Normal'],
        fontSize=10, leading=14, spaceAfter=6,
    )
    help_style = ParagraphStyle(
        'HelpText', parent=styles['Normal'],
        fontSize=9, leading=12, spaceAfter=4,
        textColor=HexColor('#555555'), leftIndent=12,
    )

    story = []
    story.append(Paragraph("LOAN AGREEMENT ESCALATION PACKAGE", title_style))
    story.append(Paragraph(
        f"Borrower: {extraction.borrower_name or 'N/A'} | "
        f"Lender: {extraction.lender_name or 'N/A'}",
        body_style,
    ))
    story.append(HRFlowable(width="100%", thickness=1, color=HexColor('#333366')))
    story.append(Spacer(1, 0.2 * inch))

    # Add usage instructions at the top
    story.append(Paragraph("HOW TO USE THESE LETTERS", heading_style))
    story.append(Paragraph(
        "These three letters follow RBI's official escalation process. "
        "Start with Level 1 and only move to the next level if the previous one fails. "
        "Each letter builds on the previous complaint and increases pressure on the bank.",
        body_style,
    ))
    story.append(Spacer(1, 0.2 * inch))

    level_colors = {1: '#2d6a4f', 2: '#b5451b', 3: '#7b2d8b'}

    for esc in escalations:
        color = level_colors.get(esc.level, '#333366')
        
        # Level title
        story.append(Paragraph(
            f"LEVEL {esc.level}: {esc.title.upper()}",
            ParagraphStyle('LevelTitle', parent=heading_style, textColor=HexColor(color)),
        ))
        
        # Plain English guidance — when to use this letter
        if hasattr(esc, 'level_plain_title') and esc.level_plain_title:
            story.append(Paragraph(f"<b>{esc.level_plain_title}</b>", help_style))
        
        if hasattr(esc, 'when_to_use') and esc.when_to_use:
            story.append(Paragraph(f"<i>When to use:</i> {esc.when_to_use}", help_style))
        
        if hasattr(esc, 'expected_outcome') and esc.expected_outcome:
            story.append(Paragraph(f"<i>What happens next:</i> {esc.expected_outcome}", help_style))
        
        story.append(Spacer(1, 0.1 * inch))
        
        # Formal letter details
        story.append(Paragraph(f"<b>To:</b> {esc.recipient}", body_style))
        story.append(Paragraph(f"<b>Subject:</b> {esc.subject}", body_style))
        story.append(Spacer(1, 0.1 * inch))

        # Letter body — replace \n with <br/> for ReportLab
        body_html = esc.body.replace('\n', '<br/>')
        story.append(Paragraph(body_html, body_style))

        if esc.rbi_references:
            story.append(Spacer(1, 0.1 * inch))
            story.append(Paragraph(
                f"<b>RBI References:</b> {', '.join(esc.rbi_references)}",
                body_style,
            ))

        story.append(HRFlowable(width="100%", thickness=0.5, color=HexColor('#cccccc')))
        story.append(Spacer(1, 0.3 * inch))

    doc.build(story)
    return buffer.getvalue()
