"""
generate_samples.py
-------------------
Generates 5 realistic Indian loan agreement PDFs for LoanGuard testing.
Each sample is calibrated to trigger a specific risk score & violation set.

EMI formula: EMI = P × r(1+r)^n / ((1+r)^n − 1)

Sample | Borrower              | Type            | Risk     | Key Violations
-------|-----------------------|-----------------|----------|----------------------------------------------
  1    | Sarvan Kumar          | Personal Loan   | CRITICAL | Penal stacking, data abuse, threats, APR gap
  2    | Sarvan Ramesh         | Home Loan       | HIGH     | No KFS, APR mismatch, spread discretion
  3    | Sarvan Krishnamurthy  | Personal Loan   | LOW      | Fully RBI-compliant, KFS included
  4    | Sarvan Malhotra       | Credit Card     | MEDIUM   | Auto-limit increase, full-balance interest
  5    | Sarvan Nair           | Gold Loan/BNPL  | HIGH     | Forced insurance, no cooling-off, ambiguous tenure
"""

from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer,
    HRFlowable, Table, TableStyle, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, white, black
import os
import math

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
styles = getSampleStyleSheet()

# ── Style Factory ──────────────────────────────────────────────────────────────

def make_style(name, parent='Normal', fontSize=10, bold=False,
               color='#1a1a1a', spaceAfter=6, spaceBefore=0,
               alignment=0, leftIndent=0):
    return ParagraphStyle(
        name,
        parent=styles[parent],
        fontSize=fontSize,
        fontName='Helvetica-Bold' if bold else 'Helvetica',
        textColor=HexColor(color),
        spaceAfter=spaceAfter,
        spaceBefore=spaceBefore,
        leading=fontSize * 1.5,
        alignment=alignment,
        leftIndent=leftIndent,
    )

title_style  = make_style('T',   fontSize=15, bold=True,  color='#0d1b2a', spaceAfter=4,  alignment=1)
sub_style    = make_style('SB',  fontSize=10, bold=True,  color='#1a3a5c', spaceAfter=2,  alignment=1)
h2_style     = make_style('H2',  fontSize=11, bold=True,  color='#1a3a5c', spaceAfter=4,  spaceBefore=8)
h3_style     = make_style('H3',  fontSize=9,  bold=True,  color='#2d4a6a', spaceAfter=2)
body_style   = make_style('B',   fontSize=9,  color='#2d2d2d', spaceAfter=4)
small_style  = make_style('S',   fontSize=7,  color='#555555', spaceAfter=3)
red_style    = make_style('R',   fontSize=8,  bold=True,  color='#b91c1c', spaceAfter=4)
stamp_style  = make_style('ST',  fontSize=8,  color='#555555', spaceAfter=2, alignment=1)
kfs_style    = make_style('KFS', fontSize=9,  bold=True,  color='#065f46', spaceAfter=4)
warn_style   = make_style('W',   fontSize=8,  bold=True,  color='#92400e', spaceAfter=3,  leftIndent=10)
fine_style   = make_style('F',   fontSize=6,  color='#888888', spaceAfter=2)

# ── Layout Helpers ─────────────────────────────────────────────────────────────

def hr(story, color='#cccccc', thickness=0.5):
    story.append(HRFlowable(width='100%', thickness=thickness, color=HexColor(color)))
    story.append(Spacer(1, 0.15 * cm))

def thick_hr(story):
    hr(story, color='#1a3a5c', thickness=1.0)

def section(story, heading, *paragraphs, style=body_style):
    items = [Paragraph(heading, h2_style)]
    for p in paragraphs:
        items.append(Paragraph(p, style))
    hr(story)
    story.append(KeepTogether(items))
    story.append(Spacer(1, 0.15 * cm))

def kfs_row(label, value):
    return [Paragraph(label, h3_style), Paragraph(value, body_style)]

def build_kfs_table(rows):
    t = Table(rows, colWidths=[6 * cm, 10 * cm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), HexColor('#e8f4f8')),
        ('BACKGROUND', (1, 0), (1, -1), HexColor('#ffffff')),
        ('BOX',        (0, 0), (-1, -1), 0.5, HexColor('#94a3b8')),
        ('INNERGRID',  (0, 0), (-1, -1), 0.25, HexColor('#cbd5e1')),
        ('TOPPADDING',    (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 8),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return t

def amortization_table(principal, annual_rate_pct, tenure_months, rows_to_show=6):
    r = annual_rate_pct / 100 / 12
    n = tenure_months
    emi = principal * r * (1 + r) ** n / ((1 + r) ** n - 1)
    data = [['Month', 'Opening Balance (₹)', 'EMI (₹)', 'Principal (₹)', 'Interest (₹)', 'Closing Balance (₹)']]
    balance = principal
    for month in range(1, rows_to_show + 1):
        interest = balance * r
        prin = emi - interest
        closing = balance - prin
        data.append([
            str(month),
            f'{balance:,.0f}',
            f'{emi:,.0f}',
            f'{prin:,.0f}',
            f'{interest:,.0f}',
            f'{max(closing, 0):,.0f}',
        ])
        balance = max(closing, 0)
    t = Table(data, colWidths=[1.5*cm, 3.2*cm, 2.5*cm, 2.8*cm, 2.5*cm, 3.2*cm])
    t.setStyle(TableStyle([
        ('BACKGROUND',     (0, 0), (-1,  0), HexColor('#1a3a5c')),
        ('TEXTCOLOR',      (0, 0), (-1,  0), white),
        ('FONTNAME',       (0, 0), (-1,  0), 'Helvetica-Bold'),
        ('FONTSIZE',       (0, 0), (-1, -1), 7.5),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#f0f7ff'), HexColor('#ffffff')]),
        ('GRID',           (0, 0), (-1, -1), 0.25, HexColor('#cbd5e1')),
        ('ALIGN',          (0, 0), (-1, -1), 'CENTER'),
        ('TOPPADDING',     (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING',  (0, 0), (-1, -1), 4),
    ]))
    return emi, t

# ── EMI Helpers ────────────────────────────────────────────────────────────────

def calc_emi(principal, annual_rate_pct, tenure_months):
    r = annual_rate_pct / 100 / 12
    n = tenure_months
    return principal * r * (1 + r) ** n / ((1 + r) ** n - 1)

def calc_total_repayment(principal, annual_rate_pct, tenure_months):
    return calc_emi(principal, annual_rate_pct, tenure_months) * tenure_months


# ─────────────────────────────────────────────────────────────────────────────
# SAMPLE 1 — CRITICAL RISK
# Borrower: Sarvan Kumar
# Loan:     Personal Loan | ₹5,00,000 | 24% | 36 months
#
# Violations:
#   [V1] EMI stated ₹19,800 vs correct ₹19,603 → 1.01% deviation
#   [V2] Penal interest 4%/month compounded into principal → RBI/2023-24/53 breach
#   [V3] Late payment fee ₹500/day ON TOP of penal interest → double-charging
#   [V4] APR not disclosed → RBI KFS mandate breach
#   [V5] Irrevocable NACH with excess debit rights → NPCI violation
#   [V6] Data sharing with marketing partners without consent → DPDP Act 2023 breach
#   [V7] Criminal threats + asset seizure without court order → RBI FPC Code breach
#   [V8] No KFS provided
#
# Expected FinShield output:
#   borrower_name        = "Sarvan Kumar"
#   lender_name          = "QuickCash Finance Pvt. Ltd."
#   principal            = 500000
#   interest_rate        = 24.0
#   tenure_months        = 36
#   emi_stated           = 19800
#   expected_emi         ≈ 19603
#   emi_deviation_percent≈ 1.01
#   kfs_present          = False
#   processing_fee       = 17500
#   insurance_premium    = 10000
#   prepayment_penalty_percent = 6.0  (foreclosure charge)
#   penal_interest_rate  = 48.0  (4%/month × 12)
#   risk_category        = CRITICAL
#   violation_count      ≥ 7
# ─────────────────────────────────────────────────────────────────────────────

def generate_sample_1():
    path = os.path.join(OUTPUT_DIR, 'sample_1_critical_risk.pdf')
    doc = SimpleDocTemplate(path, pagesize=A4,
                            rightMargin=2*cm, leftMargin=2*cm,
                            topMargin=2*cm,   bottomMargin=2*cm)
    story = []

    principal   = 500_000
    rate        = 24.0
    tenure      = 36
    correct_emi = calc_emi(principal, rate, tenure)   # ≈ 19,603
    stated_emi  = 19_800                               # intentional overstatement
    deviation   = (stated_emi - correct_emi) / correct_emi * 100
    proc_fee    = 17_500    # 3.5% of principal
    insurance   = 10_000
    net_disbursed = principal - proc_fee - insurance   # ₹4,72,500

    story.append(Paragraph('PERSONAL LOAN AGREEMENT', title_style))
    story.append(Paragraph('QuickCash Finance Pvt. Ltd. | RBI NBFC Registration No. N-13.02241', stamp_style))
    story.append(Paragraph('CIN: U65929MH2018PTC308621 | Registered Office: 5th Floor, Lotus Tower, Andheri East, Mumbai – 400069', stamp_style))
    story.append(Paragraph('Agreement Ref: QCF/2025/PL/00847 | Date: 15th January 2025', stamp_style))
    story.append(Spacer(1, 0.3 * cm))
    thick_hr(story)
    story.append(Spacer(1, 0.2 * cm))

    # [V8] No KFS — document starts directly without KFS

    section(story, '1. PARTIES TO THE AGREEMENT',
        '<b>Lender:</b> QuickCash Finance Pvt. Ltd., hereinafter referred to as "the Company" or "Lender".',
        '<b>Borrower:</b> Sarvan Kumar, S/O Shri Ramesh Kumar, Residing at 14B, Shanti Nagar, '
        'Pune – 411001, Aadhaar No: XXXX-XXXX-3471, PAN: BJKPS8821M, hereinafter "Borrower".',
    )

    # [V1] EMI overstated  [V4] APR not disclosed
    section(story, '2. LOAN DETAILS',
        '<b>Principal Amount Sanctioned:</b> INR 5,00,000 (Rupees Five Lakhs Only)',
        '<b>Annual Interest Rate:</b> 24.00% per annum (on reducing balance basis)',
        f'<b>EMI Amount:</b> INR {stated_emi:,} per month '
        f'(Note: Deterministic EMI at 24% p.a. = ₹{correct_emi:,.0f}; '
        f'stated amount is ₹{stated_emi - correct_emi:,.0f} higher — {deviation:.2f}% overstatement)',
        '<b>Annual Percentage Rate (APR):</b> Not separately disclosed. The effective cost of credit '
        'incorporating all fees and charges shall be determined by the Lender at its discretion and '
        'shall be communicated separately if requested.',
        f'<b>Loan Tenure:</b> {tenure} months',
        f'<b>Processing Fee:</b> INR {proc_fee:,} (3.5% of principal, deducted upfront)',
        f'<b>Mandatory Insurance Premium:</b> INR {insurance:,} (deducted from disbursement)',
        f'<b>Net Disbursement to Borrower:</b> INR {net_disbursed:,}',
        f'<b>Total Repayable (stated):</b> INR {stated_emi * tenure:,} | '
        f'<b>Total Repayable (correct):</b> INR {correct_emi * tenure:,.0f}',
        f'<b>Overcharge over tenure:</b> INR {(stated_emi - correct_emi) * tenure:,.0f}',
    )

    # [V2] [V3] — Double penal charges
    section(story, '3. FEES AND CHARGES SCHEDULE',
        '<b>GST @ 18%:</b> Applicable on processing fee, interest, and all service charges',
        '<b>Documentation Charges:</b> INR 2,500 (non-refundable)',
        '<b>Mandatory Insurance Premium:</b> INR 10,000 (single premium, deducted from disbursement; '
        'Borrower has no option to choose alternate insurer)',
        '<b>Bounce Charge:</b> INR 1,200 per dishonoured ECS/NACH instruction',
        '<b>Penal Interest [VIOLATION]:</b> 4% per month on overdue outstanding amount, '
        '<u>compounded monthly and capitalised into principal outstanding</u>. '
        'This is in addition to the contractual interest rate. '
        '(Effective annual penal rate: 48% p.a. — RBI/2023-24/53 prohibits compounding into principal)',
        '<b>Late Payment Fee [VIOLATION — double charge]:</b> INR 500 per calendar day of delay, '
        'charged in addition to penal interest above.',
        '<b>Loan Cancellation Fee:</b> INR 5,000 if loan cancelled after disbursement '
        '(no cooling-off period provided)',
    )

    section(story, '4. INTEREST RATE RESET',
        'The Lender reserves the right to revise the applicable interest rate at any time without prior '
        'notice to the Borrower. Revised rates shall be effective from the date of intimation via SMS/email. '
        'If the Borrower does not respond within 7 days, the revised rate is deemed accepted.',
        'The internal benchmark rate (IBR) is determined solely by the Lender based on market conditions, '
        'cost of funds, and operational considerations. The Lender\'s assessment of the IBR is final and '
        'not subject to challenge or review.',
    )

    # [V5] — Irrevocable NACH
    section(story, '5. REPAYMENT AND AUTO-DEBIT MANDATE',
        'The Borrower hereby irrevocably and unconditionally authorises the Lender to debit ANY AMOUNT '
        'from the Borrower\'s bank account including EMI, penal charges, fees, insurance, and any other '
        'dues as determined by the Lender, without further intimation or consent.',
        'NACH/ECS mandate once registered CANNOT be cancelled or revoked during the loan tenure. '
        'Any attempt to cancel the mandate shall be treated as wilful default.',
        'The Lender may debit amounts in excess of the scheduled EMI in case of fee recalculation, '
        'penal charge capitalisation, or any other charge at the Lender\'s discretion.',
        'The Borrower shall maintain a minimum balance of INR 25,000 in the linked account at all times.',
    )

    section(story, '6. PREPAYMENT AND FORECLOSURE',
        'Part-prepayment is not permitted during the entire loan tenure.',
        'Foreclosure is permitted only after 18 EMIs. Foreclosure charges: 6% of outstanding principal + GST.',
        'On foreclosure, all accrued penal interest, late payment fees, insurance charges, and any '
        'other amounts as determined by the Lender become immediately due and payable.',
        'The Lender will not issue a No-Objection Certificate (NOC) until all outstanding dues '
        'including disputed amounts are cleared in full.',
    )

    # [V7] — Threatening language, unlawful recovery
    section(story, '7. DEFAULT AND RECOVERY — IMPORTANT NOTICE', style=red_style,
        *[
        '⚠ IN THE EVENT OF DEFAULT OR DISHONOUR OF ANY EMI:',
        '(a) The Lender shall immediately report the Borrower — Sarvan Kumar — to all four credit '
        'bureaus (CIBIL, Experian, CRIF, Equifax), resulting in permanent damage to credit profile.',
        '(b) Recovery agents authorised by the Lender are permitted to visit the Borrower\'s '
        'residence, workplace, and any other location to compel payment. Agents may contact '
        'family members, neighbours, employer, and references without restriction.',
        '(c) The Lender reserves the right to seize, attach, and liquidate the Borrower\'s moveable '
        'and immoveable assets, bank accounts, and salary WITHOUT obtaining a court order, in case '
        'of default exceeding 30 days. This right is exercised under the contractual lien herein.',
        '(d) A criminal complaint shall be filed under Section 138 of the Negotiable Instruments Act, '
        'Section 420 IPC (cheating), and applicable IBC provisions without further notice.',
        '(e) <u>THIS IS A FINAL WARNING. NO FURTHER NOTICE WILL BE ISSUED BEFORE LEGAL ACTION.</u>',
        ]
    )

    # [V6] — Data sharing without consent
    section(story, '8. DATA CONSENT AND PRIVACY',
        'The Borrower unconditionally consents to the Lender sharing all personal, financial, '
        'and transactional data with: (i) third-party marketing and fintech partners, (ii) group '
        'companies, (iii) collection agencies, (iv) credit bureaus, (v) any other entity at the '
        'Lender\'s discretion, without further notice or separate consent.',
        'The mobile application associated with this loan product may access: phone contacts, '
        'call logs, SMS inbox, location data (real-time), camera, and installed applications '
        'for the purposes of credit assessment, fraud detection, and recovery. '
        'This consent is irrevocable for the duration of the loan and 3 years thereafter.',
        'Silence or non-response from the Borrower on any communication from the Lender '
        'shall be treated as unconditional acceptance of any revised terms.',
    )

    story.append(Paragraph(
        '* This agreement is subject to change at the sole discretion of QuickCash Finance Pvt. Ltd. '
        'without notice. Borrower\'s continued use of disbursed funds implies acceptance of all terms.',
        fine_style))
    story.append(Paragraph(
        '* Penal interest compounds monthly into principal. Late payment fee of ₹500/day accrues separately.',
        fine_style))
    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph('Borrower: Sarvan Kumar', body_style))
    story.append(Paragraph('Borrower Signature: _______________________  Date: __________', body_style))
    story.append(Paragraph('Authorised Signatory (Lender): ___________  Stamp:', body_style))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        f'[AUDIT NOTE] borrower_name=Sarvan Kumar | lender=QuickCash Finance Pvt. Ltd. | '
        f'principal=500000 | interest_rate=24.0 | tenure=36 | kfs_present=False | '
        f'insurance_premium=10000 | processing_fee=17500 | prepayment_penalty_percent=6.0 | '
        f'penal_interest_rate=48.0 (4%/month) | '
        f'correct_emi=₹{correct_emi:,.2f} | stated_emi=₹{stated_emi:,} | '
        f'emi_deviation_percent={deviation:.2f} | '
        f'overcharge_total=₹{(stated_emi - correct_emi) * tenure:,.0f} | '
        f'risk_category=CRITICAL | expected_violations=7-8',
        fine_style))

    doc.build(story)
    print(f'✅  Sample 1 (CRITICAL) — Sarvan Kumar: {path}')
    return path


# ─────────────────────────────────────────────────────────────────────────────
# SAMPLE 2 — HIGH RISK
# Borrower: Sarvan Ramesh  (Co-borrower: Meena Ramesh / spouse)
# Loan:     Home Loan | ₹36,00,000 | 8.75% floating | 240 months
#
# Violations:
#   [V1] Stated APR 10.2% but true APR with all fees ≈ 11.4% → mismatch
#   [V2] No KFS (explicitly waived in agreement text)
#   [V3] Spread revision without borrower consent → non-transparent
#   [V4] Annual account maintenance fee ₹2,000/yr not in total repayment
#   [V5] Insurance described as "optional" but premium deducted at source
#
# Expected FinShield output:
#   borrower_name        = "Sarvan Ramesh"
#   lender_name          = "IndiaFirst Housing Finance Ltd."
#   principal            = 3600000
#   interest_rate        = 8.75
#   apr                  = 10.2  (stated) — true APR ≈ 11.4
#   tenure_months        = 240
#   kfs_present          = False
#   insurance_premium    = 45000
#   processing_fee       = 72000
#   risk_category        = HIGH
#   violation_count      ≈ 4-5
# ─────────────────────────────────────────────────────────────────────────────

def generate_sample_2():
    path = os.path.join(OUTPUT_DIR, 'sample_2_high_risk_homeloan.pdf')
    doc = SimpleDocTemplate(path, pagesize=A4,
                            rightMargin=2*cm, leftMargin=2*cm,
                            topMargin=2*cm,   bottomMargin=2*cm)
    story = []

    principal    = 3_600_000
    rate         = 8.75
    tenure       = 240
    correct_emi  = calc_emi(principal, rate, tenure)
    stated_emi   = 31_800
    proc_fee     = 72_000      # 2% of principal
    gst_on_proc  = proc_fee * 0.18
    tech_fee     = 5_500
    legal_fee    = 8_000
    cersai       = 500
    insurance    = 45_000      # [V5] framed as optional but deducted
    annual_maint = 2_000       # [V4] not in total repayment
    total_fees   = proc_fee + gst_on_proc + tech_fee + legal_fee + cersai
    approx_true_apr = rate + (total_fees / principal) * 100

    story.append(Paragraph('HOME LOAN SANCTION LETTER & AGREEMENT', title_style))
    story.append(Paragraph('IndiaFirst Housing Finance Ltd.', sub_style))
    story.append(Paragraph('RBI Registered NBFC-HFC | NHB Registration: NHB.HFC.011.20140320', stamp_style))
    story.append(Paragraph('Sanction Date: 3rd February 2025 | Loan Account: IFHF/HL/2025/44821', stamp_style))
    story.append(Spacer(1, 0.3 * cm))
    thick_hr(story)
    story.append(Spacer(1, 0.2 * cm))

    section(story, '1. BORROWER AND PROPERTY DETAILS',
        '<b>Primary Borrower:</b> Sarvan Ramesh, S/O R. Ramesh, '
        '22, 4th Cross, Rajaji Nagar, Bengaluru – 560010. PAN: AVPSR7731K',
        '<b>Co-Borrower:</b> Meena Ramesh (Spouse), PAN: BRTMR5542R',
        '<b>Property Address:</b> Plot No. 47, Whitefield Extension, Bengaluru – 560066',
        '<b>Property Market Value (Technical Assessment):</b> INR 45,00,000',
        '<b>LTV Ratio:</b> 80% (INR 36,00,000 / INR 45,00,000)',
    )

    section(story, '2. LOAN SANCTION DETAILS',
        f'<b>Sanctioned Loan Amount:</b> INR {principal:,} (Rupees Thirty Six Lakhs)',
        f'<b>Nominal Interest Rate:</b> {rate}% per annum floating (linked to RLLR)',
        f'<b>Current RLLR:</b> 6.50% | <b>Spread:</b> 2.25% | <b>Effective Rate:</b> {rate}% p.a.',
        f'<b>Stated APR:</b> 10.2% per annum (as per lender disclosure) [VIOLATION: true APR ≈ {approx_true_apr:.1f}%]',
        f'<b>Computed APR (with fees):</b> approximately {approx_true_apr:.1f}% p.a. '
        f'(processing fee ₹{proc_fee:,} + GST ₹{gst_on_proc:,.0f} + tech ₹{tech_fee:,} + '
        f'legal ₹{legal_fee:,} not reflected in stated APR)',
        f'<b>Loan Tenure:</b> {tenure} months (20 years)',
        f'<b>EMI (Computed @ {rate}%):</b> INR {correct_emi:,.0f} per month',
        f'<b>Stated EMI:</b> INR {stated_emi:,} per month',
        f'<b>Net Disbursement:</b> INR {principal - proc_fee - int(gst_on_proc):,} '
        f'(after deduction of processing fee ₹{proc_fee:,} + GST ₹{gst_on_proc:,.0f})',
    )

    fees_data = [
        ['Charge', 'Amount (INR)', 'Disclosed in APR?'],
        ['Processing Fee (2%)',          f'{proc_fee:,}',         '✗ Not included'],
        ['GST on Processing Fee (18%)',  f'{gst_on_proc:,.0f}',   '✗ Not disclosed'],
        ['Technical Valuation Fee',      f'{tech_fee:,}',         '✗ Not in APR'],
        ['Legal Verification Fee',       f'{legal_fee:,}',        '✗ Not in APR'],
        ['CERSAI Registration',          f'{cersai:,}',           '✓ Nominal'],
        ['Annual Account Maintenance',   f'{annual_maint:,}/yr',  '✗ Not in repayment total'],
        ['Bounce Charge (per instance)', '750',                   'Conditional'],
        ['Rate Conversion Fee',          '1.5% of outstanding',   'If applicable'],
        ['Home Loan Insurance (framed optional)', f'{insurance:,}', '✗ Deducted at source'],
    ]
    t = Table(fees_data, colWidths=[6.5*cm, 3.5*cm, 5.7*cm])
    t.setStyle(TableStyle([
        ('BACKGROUND',   (0, 0), (-1,  0), HexColor('#1a3a5c')),
        ('TEXTCOLOR',    (0, 0), (-1,  0), white),
        ('FONTNAME',     (0, 0), (-1,  0), 'Helvetica-Bold'),
        ('FONTSIZE',     (0, 0), (-1, -1), 8),
        ('ROWBACKGROUNDS',(0, 1), (-1, -1), [HexColor('#fafafa'), HexColor('#ffffff')]),
        ('GRID',         (0, 0), (-1, -1), 0.25, HexColor('#d1d5db')),
        ('TOPPADDING',   (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING',(0, 0), (-1, -1), 4),
        ('LEFTPADDING',  (0, 0), (-1, -1), 6),
        ('TEXTCOLOR',    (2, 1), (2, -1), HexColor('#b91c1c')),
    ]))
    story.append(Paragraph('3. FEES AND CHARGES SCHEDULE', h2_style))
    story.append(t)
    story.append(Spacer(1, 0.3 * cm))
    hr(story)

    # [V3] — Spread revision without consent
    section(story, '4. FLOATING RATE AND RLLR RESET MECHANISM',
        'The applicable interest rate is floating and linked to the Lender\'s RLLR. '
        'RLLR is reviewed and reset on the 1st of every quarter.',
        'Any revision in RBI Repo Rate shall be reflected in RLLR within 3 working days.',
        '<b>Spread Revision Clause [VIOLATION]:</b> The spread component (currently 2.25%) may be '
        'revised by the Lender based on re-assessment of the Borrower\'s risk profile, change in '
        'property value, or regulatory requirements. <u>No separate consent from the Borrower is '
        'required for spread revision.</u> Borrower will be notified via email/SMS.',
        'The Borrower acknowledges that the spread revision clause is standard industry practice '
        'and has been explained verbally at the time of sanction.',
    )

    # [V2] — No KFS
    section(story, '5. KEY FACT STATEMENT (KFS)',
        '<b>NOTE [VIOLATION — RBI DOR.CRE.REC.66/2022-23]:</b> A separate Key Fact Statement '
        'has NOT been prepared for this housing finance product. '
        'The terms contained in this Sanction Letter and Loan Agreement are deemed to '
        'constitute complete and adequate disclosure.',
        f'<b>Total Amount Payable (approximate):</b> INR {stated_emi * tenure:,} over {tenure} months, '
        f'subject to RLLR changes. Annual maintenance fee of INR {annual_maint:,}/year '
        f'(total INR {annual_maint * 20:,} over tenure) not included in this estimate.',
    )

    section(story, '6. PREPAYMENT TERMS',
        'Part-prepayment: Permitted after 6 months. No charges for individual borrowers on floating rate.',
        'Full Foreclosure: Permitted at any time. No foreclosure charges for individual borrowers '
        'on floating rate home loans (as per RBI/2012-13/26).',
        'Fixed Rate Conversion: Foreclosure charge of 2% of outstanding principal applies.',
        'NOC will be issued within 5 working days of full repayment. '
        'Property documents returned within 15 days.',
    )

    # [V5] — Insurance framed optional but deducted
    section(story, '7. INSURANCE',
        'Home loan protection insurance is strongly recommended for the safety of the Borrower\'s family. '
        f'<b>The premium of INR {insurance:,} (single premium, covering loan tenure) has been included '
        'in the disbursement structure and will be deducted at source.</b> The Borrower — Sarvan Ramesh — '
        'may opt out by submitting a written request within 2 working days of this sanction letter. '
        'Post this period, the deduction is treated as confirmed.',
        'The Lender\'s subsidiary, IndiaFirst Life Insurance Co., is the default insurer. '
        'Third-party insurance may be accepted at the Lender\'s discretion.',
    )

    section(story, '8. GRIEVANCE REDRESSAL',
        'For complaints: grievance@indiafirsthousing.in | Toll-free: 1800-419-8080',
        'Nodal Officer: nodal.officer@indiafirsthousing.in | Response within 10 working days.',
        'Unresolved complaints: RBI Integrated Ombudsman at https://cms.rbi.org.in',
    )

    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph('Borrower: Sarvan Ramesh', body_style))
    story.append(Paragraph('Borrower Signature: _______________________ Date: __________', body_style))
    story.append(Paragraph('Co-Borrower (Meena Ramesh) Signature: _____ Date: __________', body_style))
    story.append(Paragraph('Authorised Signatory (Lender): ____________  Seal:', body_style))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        f'[AUDIT NOTE] borrower_name=Sarvan Ramesh | lender=IndiaFirst Housing Finance Ltd. | '
        f'principal=3600000 | interest_rate=8.75 | apr_stated=10.2 | apr_true≈{approx_true_apr:.2f} | '
        f'tenure=240 | kfs_present=False | insurance_premium=45000 | processing_fee=72000 | '
        f'prepayment_penalty_percent=0.0 (nil for floating rate individual) | '
        f'correct_emi=₹{correct_emi:,.2f} | stated_emi=₹{stated_emi:,} | '
        f'risk_category=HIGH | expected_violations=4-5',
        fine_style))

    doc.build(story)
    print(f'✅  Sample 2 (HIGH) — Sarvan Ramesh: {path}')
    return path


# ─────────────────────────────────────────────────────────────────────────────
# SAMPLE 3 — LOW RISK (clean benchmark)
# Borrower: Sarvan Krishnamurthy
# Loan:     Personal Loan | ₹2,00,000 | 12.5% fixed | 36 months
#
# No violations — used to verify FinShield does NOT false-positive.
#
# Expected FinShield output:
#   borrower_name        = "Sarvan Krishnamurthy"
#   lender_name          = "State Bank of Bharat"
#   principal            = 200000
#   interest_rate        = 12.5
#   tenure_months        = 36
#   kfs_present          = True
#   insurance_premium    = 0
#   prepayment_penalty_percent = 0.0
#   penal_interest_rate  = 0 (flat ₹250/month, not compounded)
#   emi_deviation_percent≈ 0.0
#   risk_category        = LOW
#   violation_count      = 0
# ─────────────────────────────────────────────────────────────────────────────

def generate_sample_3():
    path = os.path.join(OUTPUT_DIR, 'sample_3_low_risk_compliant.pdf')
    doc = SimpleDocTemplate(path, pagesize=A4,
                            rightMargin=2*cm, leftMargin=2*cm,
                            topMargin=2*cm,   bottomMargin=2*cm)
    story = []

    principal   = 200_000
    rate        = 12.5
    tenure      = 36
    correct_emi = calc_emi(principal, rate, tenure)
    proc_fee    = 2_000
    gst_on_fee  = proc_fee * 0.18
    total_proc  = proc_fee + gst_on_fee
    total_rep   = correct_emi * tenure
    # APR includes processing fee amortised over tenure
    apr_approx  = rate + (total_proc / principal) * 100 / tenure * 12

    story.append(Paragraph('PERSONAL LOAN AGREEMENT', title_style))
    story.append(Paragraph('State Bank of Bharat — Scheduled Commercial Bank', sub_style))
    story.append(Paragraph('RBI Licence No. MUM-101 | IFSC Base: SBOB0000001', stamp_style))
    story.append(Paragraph('Agreement Date: 10th January 2025 | Account No: SBB/PL/2025/10034', stamp_style))
    story.append(Spacer(1, 0.3 * cm))
    thick_hr(story)
    story.append(Spacer(1, 0.2 * cm))

    # Full KFS — RBI DOR.CRE.REC.66/2022-23 compliant
    story.append(Paragraph(
        'KEY FACT STATEMENT (KFS) — As mandated by RBI Circular DOR.CRE.REC.66/2022-23',
        kfs_style))
    story.append(Paragraph(
        'This KFS must be read carefully before signing the loan agreement. KFS is provided to '
        'Sarvan Krishnamurthy prior to loan disbursal.',
        small_style))
    story.append(Spacer(1, 0.2 * cm))

    kfs_rows = [
        kfs_row('Loan Type',              'Personal Loan (Unsecured)'),
        kfs_row('Borrower Name',          'Sarvan Krishnamurthy'),
        kfs_row('Principal Amount',       f'INR {principal:,}'),
        kfs_row('Annual Interest Rate',   f'{rate}% per annum (fixed, reducing balance)'),
        kfs_row('Annual Percentage Rate', f'{apr_approx:.2f}% per annum (inclusive of all fees and charges)'),
        kfs_row('EMI Amount',             f'INR {correct_emi:,.0f} per month'),
        kfs_row('Loan Tenure',            f'{tenure} months'),
        kfs_row('Total Repayment Amount', f'INR {total_rep:,.0f} (principal + interest)'),
        kfs_row('Processing Fee',         f'INR {proc_fee:,} + GST @ 18% = INR {total_proc:,.0f} (one-time, at disbursal)'),
        kfs_row('Penal Charges',          'INR 250 per month of delay (flat rate, NOT compounded, NOT added to principal)'),
        kfs_row('Bounce Charge',          'INR 400 per dishonoured ECS/NACH instruction'),
        kfs_row('Prepayment Charges',     'Nil for individual borrowers'),
        kfs_row('Foreclosure Charges',    'Nil after 12 months; INR 500 within first 12 months'),
        kfs_row('Cooling-Off Period',     '3 business days from disbursement (loan can be cancelled without penalty)'),
        kfs_row('Insurance',              'Optional — not mandatory. No premium deducted without explicit written consent.'),
        kfs_row('Grievance Contact',      'grievance@statebankofbharat.in | 1800-XXX-XXXX (toll-free)'),
        kfs_row('RBI Ombudsman',          'https://cms.rbi.org.in | Scheme 2021 (RBI/2021-22/117)'),
    ]
    story.append(build_kfs_table(kfs_rows))
    story.append(Spacer(1, 0.3 * cm))
    hr(story)

    section(story, '1. PARTIES TO THE AGREEMENT',
        '<b>Lender:</b> State Bank of Bharat, Main Branch, Anna Nagar, Chennai – 600040',
        '<b>Borrower:</b> Sarvan Krishnamurthy, S/O K. Krishnamurthy, '
        '78, 3rd Street, Besant Nagar, Chennai – 600090. PAN: AJPSK8812L',
    )

    section(story, '2. LOAN DETAILS (CONSISTENT WITH KFS ABOVE)',
        f'<b>Principal:</b> INR {principal:,}',
        f'<b>Interest Rate:</b> {rate}% per annum (fixed, reducing balance)',
        f'<b>APR:</b> {apr_approx:.2f}% per annum (inclusive of processing fee)',
        f'<b>EMI:</b> INR {correct_emi:,.0f} per month (computed via standard formula: '
        f'P × r(1+r)^n / ((1+r)^n − 1))',
        f'<b>Tenure:</b> {tenure} months',
        f'<b>Total Repayment:</b> INR {total_rep:,.0f}',
        f'<b>Net Disbursement:</b> INR {principal - int(total_proc):,} '
        f'(after processing fee ₹{total_proc:,.0f})',
    )

    story.append(Paragraph('3. REPAYMENT SCHEDULE (First 6 Months)', h2_style))
    _, amort = amortization_table(principal, rate, tenure, 6)
    story.append(amort)
    story.append(Spacer(1, 0.3 * cm))
    hr(story)

    section(story, '4. PENAL CHARGES — RBI COMPLIANT',
        '<b>Penal charges for late payment:</b> INR 250 per month of delay (flat rate).',
        '<b>Penal charges are NOT compounded</b> and will NOT be added to the outstanding '
        'principal balance, as mandated by RBI Circular RBI/2023-24/53 dated 18th August 2023.',
        '<b>Penal charges will be displayed separately</b> in every account statement, '
        'distinct from the principal and interest components.',
        '<b>Bounce charge:</b> INR 400 per dishonoured ECS/NACH instruction (charged once per event).',
    )

    section(story, '5. PREPAYMENT AND FORECLOSURE',
        'Part-prepayment: Permitted at any time without any charges.',
        'Full foreclosure: No charges after 12 months. Within 12 months: INR 500 administrative fee.',
        'Foreclosure statement issued within 3 working days of request.',
        'NOC and loan closure documents dispatched within 7 working days of final payment.',
    )

    section(story, '6. NACH / AUTO-DEBIT TERMS',
        'NACH mandate is registered for the scheduled EMI amount only.',
        'The Bank will NOT debit any amount beyond the scheduled EMI without separate written consent.',
        'NACH mandate can be cancelled by the Borrower with 15 days prior written notice, '
        'provided an alternate repayment arrangement is established.',
    )

    section(story, '7. GRIEVANCE REDRESSAL',
        'For complaints: grievance@statebankofbharat.in | 1800-XXX-XXXX (toll-free, 24×7)',
        'Nodal Officer: nodal.officer@statebankofbharat.in | Response within 7 working days.',
        'If not resolved in 30 days: RBI Integrated Ombudsman at https://cms.rbi.org.in | '
        'Reference: RBI Ombudsman Scheme 2021 (RBI/2021-22/117)',
    )

    section(story, '8. DATA PROTECTION',
        'Borrower data will be shared ONLY with credit bureaus (CIBIL, Experian, CRIF, Equifax) '
        'as per RBI guidelines and applicable law.',
        'Data will NOT be shared with third-party marketing agencies or affiliates without '
        'separate, explicit, written consent from the Borrower.',
        'Borrower may request data correction or deletion after loan closure as per DPDP Act, 2023.',
    )

    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph('Borrower: Sarvan Krishnamurthy', body_style))
    story.append(Paragraph('Borrower Signature: _______________________ Date: __________', body_style))
    story.append(Paragraph('Bank Manager: ____________________________ Branch Seal:', body_style))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        f'[AUDIT NOTE] borrower_name=Sarvan Krishnamurthy | lender=State Bank of Bharat | '
        f'principal=200000 | interest_rate=12.5 | apr={apr_approx:.2f} | tenure=36 | '
        f'kfs_present=True | insurance_premium=0 | processing_fee={int(total_proc)} | '
        f'prepayment_penalty_percent=0.0 | penal_interest_rate=0 (flat ₹250/month) | '
        f'correct_emi=₹{correct_emi:,.2f} | emi_deviation=0% | '
        f'total_repayment=₹{total_rep:,.0f} | '
        f'risk_category=LOW | expected_violations=0',
        fine_style))

    doc.build(story)
    print(f'✅  Sample 3 (LOW) — Sarvan Krishnamurthy: {path}')
    return path


# ─────────────────────────────────────────────────────────────────────────────
# SAMPLE 4 — MEDIUM RISK
# Borrower: Sarvan Malhotra
# Product:  Credit Card | Zenith Bank Platinum Rewards
#
# Violations:
#   [V1] Automatic credit limit increase without consent → RBI FPC violation
#   [V2] Interest charged on FULL balance even after partial payment
#   [V3] GST misapplied on entire outstanding (not just fee component)
#   [V4] Annual fee stated as "non-waivable" → contradicts RBI card guidelines
#
# Expected FinShield output:
#   borrower_name        = "Sarvan Malhotra"
#   lender_name          = "Zenith Bank Ltd."
#   loan_type            = "Credit Card"
#   kfs_present          = False (no KFS for credit card product)
#   bank_discretion_clause = True
#   risk_category        = MEDIUM
#   violation_count      ≈ 3-4
# ─────────────────────────────────────────────────────────────────────────────

def generate_sample_4():
    path = os.path.join(OUTPUT_DIR, 'sample_4_credit_card_medium.pdf')
    doc = SimpleDocTemplate(path, pagesize=A4,
                            rightMargin=2*cm, leftMargin=2*cm,
                            topMargin=2*cm,   bottomMargin=2*cm)
    story = []

    story.append(Paragraph('CREDIT CARD MEMBER AGREEMENT', title_style))
    story.append(Paragraph('Zenith Bank Ltd. — Platinum Rewards Credit Card', sub_style))
    story.append(Paragraph('Card No: XXXX-XXXX-XXXX-4821 | Issue Date: 20 December 2024 | Valid Thru: 12/27', stamp_style))
    story.append(Paragraph('RBI Authorised Bank | CIN: L65110MH1994PLC077093', stamp_style))
    story.append(Spacer(1, 0.3 * cm))
    thick_hr(story)
    story.append(Spacer(1, 0.2 * cm))

    section(story, '1. CARDHOLDER DETAILS',
        '<b>Primary Cardholder:</b> Sarvan Malhotra, S/O R. Malhotra, '
        'B-204, Vasant Vihar, New Delhi – 110057. PAN: CLMSM9934K',
        '<b>Credit Limit:</b> INR 3,00,000',
        '<b>Cash Advance Limit:</b> INR 75,000 (25% of credit limit)',
        '<b>Minimum Payment Due:</b> Higher of 5% of total outstanding or INR 200',
    )

    rates_data = [
        ['Charge Type',         'Rate / Amount',                 'Notes'],
        ['Purchase APR',        '42% p.a. (3.5%/month)',         'Charged if full due not paid'],
        ['Cash Advance APR',    '48% p.a. (4%/month)',           'From date of transaction'],
        ['Late Payment Fee',    '₹1,000 (outstanding > ₹10,000)','Per billing cycle'],
        ['Annual Fee',          '₹2,999 + GST = ₹3,538.82',     'Auto-debited; stated non-waivable [VIOLATION]'],
        ['Over-Limit Fee',      '₹600/month',                    'If limit exceeded'],
        ['Fuel Surcharge',      '1% of transaction',             'At all fuel stations'],
        ['Foreign Transaction', '3.5% of transaction',           'All international spends'],
        ['Cheque/ECS Bounce',   '₹500 per instance',             ''],
        ['Card Replacement',    '₹250 + GST',                    ''],
    ]
    t = Table(rates_data, colWidths=[5*cm, 5.5*cm, 5.2*cm])
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1,  0), HexColor('#1a3a5c')),
        ('TEXTCOLOR',     (0, 0), (-1,  0), white),
        ('FONTNAME',      (0, 0), (-1,  0), 'Helvetica-Bold'),
        ('FONTSIZE',      (0, 0), (-1, -1), 8),
        ('ROWBACKGROUNDS',(0, 1), (-1, -1), [HexColor('#fafafa'), HexColor('#ffffff')]),
        ('GRID',          (0, 0), (-1, -1), 0.25, HexColor('#d1d5db')),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
    ]))
    story.append(Paragraph('2. INTEREST RATES AND CHARGES', h2_style))
    story.append(t)
    story.append(Spacer(1, 0.3 * cm))
    hr(story)

    # [V1] — Auto limit increase without consent
    section(story, '3. CREDIT LIMIT MANAGEMENT [VIOLATION — RBI FPC]',
        'The Bank reserves the right to increase or decrease the credit limit at its sole discretion '
        'without prior notice. <b>Automatic credit limit enhancements will be applied based on '
        'spending and repayment patterns of Sarvan Malhotra.</b> Use of the card after a limit '
        'change constitutes acceptance of the revised limit.',
        'Interest at the revised rate (if applicable) will be applied from the effective date of change.',
        'The Cardholder may opt out of automatic limit increases by calling the helpline, '
        'subject to processing time of up to 10 working days.',
    )

    # [V2] — Full balance interest trap
    section(story, '4. INTEREST COMPUTATION — IMPORTANT [VIOLATION]',
        '<b>Full Balance Interest:</b> If the Cardholder does not pay the Total Amount Due in full '
        'by the payment due date, interest at the applicable APR will be charged on the '
        '<u>ENTIRE outstanding balance from the statement date</u>, '
        'not merely the remaining unpaid balance.',
        '<b>Illustrative Example:</b> Statement balance: INR 50,000. '
        'Payment made by Sarvan Malhotra: INR 25,000 (50% of due). '
        'Interest next cycle: INR 50,000 × 3.5% = INR 1,750 '
        '(computed on original INR 50,000, not on INR 25,000 remaining).',
        '<b>Interest-Free Period:</b> Up to 50 days from purchase date, available ONLY if the '
        'TOTAL outstanding balance is paid in full by the due date in TWO consecutive cycles.',
    )

    # [V3] — GST misapplied on full balance
    section(story, '5. GST APPLICATION [VIOLATION]',
        'GST at 18% shall be applied on: (i) all interest charges, (ii) all fees, '
        '(iii) the total outstanding balance computation for minimum payment purposes.',
        'Specifically, for the purpose of calculating minimum payment due, GST @ 18% is added '
        'to the total outstanding balance before applying the 5% minimum payment percentage.',
        '<b>Example:</b> Outstanding INR 50,000 → GST-adjusted balance = INR 59,000 → '
        'Minimum due = INR 2,950 (5% of INR 59,000) vs regulatory minimum of INR 2,500.',
    )

    section(story, '6. RECOVERY AND COLLECTION',
        'Default of 60+ days: Bank will report to all four credit bureaus immediately.',
        'Collection agents will be engaged with 7-day advance notice.',
        'Agents authorised to contact cardholder between 8:00 AM and 8:00 PM only '
        '(as per RBI FPC guidelines).',
        'All agents carry official identity cards and are prohibited from using intimidating language.',
    )

    section(story, '7. DISPUTE RESOLUTION',
        'Transaction disputes must be raised within 30 days of statement date.',
        'Grievance: customer.care@zenithbank.in | Nodal Officer: nodal@zenithbank.in',
        'Escalation: RBI Banking Ombudsman at https://cms.rbi.org.in',
    )

    story.append(Paragraph(
        '* By activating this card, the Cardholder — Sarvan Malhotra — agrees to all terms. '
        'Annual fee is charged on card anniversary date and is stated as non-refundable and non-waivable.',
        small_style))
    story.append(Paragraph(
        '* Interest rates are subject to change as per RBI guidelines with 30-day prior notice.',
        fine_style))
    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph('Cardholder: Sarvan Malhotra', body_style))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        '[AUDIT NOTE] borrower_name=Sarvan Malhotra | lender=Zenith Bank Ltd. | '
        'loan_type=Credit Card | kfs_present=False | bank_discretion_clause=True | '
        'auto_debit_consent=True | bounce_charge=500 | '
        'risk_category=MEDIUM | expected_violations=3-4',
        fine_style))

    doc.build(story)
    print(f'✅  Sample 4 (MEDIUM) — Sarvan Malhotra: {path}')
    return path


# ─────────────────────────────────────────────────────────────────────────────
# SAMPLE 5 — HIGH RISK
# Borrower: Sarvan Nair
# Loan:     Gold Loan + BNPL Hybrid | SuvaRNA FinServ
#           Gold appraised ₹2,50,000 | LTV 75% → Disbursed ₹1,87,500
#           Rate: 18% | Tenure: 12 months
#
# Violations:
#   [V1] No cooling-off period
#   [V2] Ambiguous tenure ("on demand / bullet repayment")
#   [V3] EMI computed on appraised gold value (₹2,50,000), not disbursed amount (₹1,87,500)
#   [V4] Forced in-house insurance — third-party not accepted
#   [V5] Auction without court order after 7-day notice
#   [V6] BNPL 0% interest misrepresented — retroactive 36% if default
#   [V7] No KFS for BNPL component
#
# Expected FinShield output:
#   borrower_name        = "Sarvan Nair"
#   lender_name          = "SuvaRNA FinServ Pvt. Ltd."
#   principal            = 187500
#   interest_rate        = 18.0
#   tenure_months        = 12
#   kfs_present          = False (BNPL — stated not applicable)
#   insurance_premium    = 1875
#   processing_fee       = 2813  (1.5% of ₹1,87,500)
#   emi_stated           ≈ inflated_emi (computed on ₹2,50,000)
#   expected_emi         ≈ correct_emi  (computed on ₹1,87,500)
#   emi_deviation_percent≈ 33.3%  (overcharged by 1/3)
#   risk_category        = HIGH
#   violation_count      ≈ 5-7
# ─────────────────────────────────────────────────────────────────────────────

def generate_sample_5():
    path = os.path.join(OUTPUT_DIR, 'sample_5_high_risk_goldloan.pdf')
    doc = SimpleDocTemplate(path, pagesize=A4,
                            rightMargin=2*cm, leftMargin=2*cm,
                            topMargin=2*cm,   bottomMargin=2*cm)
    story = []

    gold_value   = 250_000
    ltv          = 0.75
    principal    = int(gold_value * ltv)          # ₹1,87,500 — actual disbursed amount
    rate         = 18.0
    tenure       = 12
    correct_emi  = calc_emi(principal, rate, tenure)    # EMI on disbursed amount
    inflated_emi = calc_emi(gold_value, rate, tenure)   # [V3] EMI on gold_value (wrong)
    deviation    = (inflated_emi - correct_emi) / correct_emi * 100
    proc_fee     = round(principal * 0.015, 2)           # 1.5% = ₹2,812.50
    insurance    = 1_875     # charged on gold_value, not principal

    story.append(Paragraph('GOLD LOAN AGREEMENT & BNPL FACILITY TERMS', title_style))
    story.append(Paragraph('SuvaRNA FinServ Pvt. Ltd. | RBI NBFC-Gold Loan Specialist', sub_style))
    story.append(Paragraph('CIN: U65929KA2019PTC121547 | RBI Reg: N-13.04892', stamp_style))
    story.append(Paragraph('Agreement Date: 5th March 2025 | Loan Ref: SVN/GL/2025/08812', stamp_style))
    story.append(Spacer(1, 0.3 * cm))
    thick_hr(story)
    story.append(Spacer(1, 0.2 * cm))

    # [V7] — No KFS for BNPL
    story.append(Paragraph(
        '⚠ Note: Key Fact Statement has NOT been issued for the BNPL component of this facility '
        'as the Company considers digital BNPL products outside the purview of RBI KFS guidelines. '
        'All terms are governed by this agreement and the mobile app Terms & Conditions.',
        warn_style))
    story.append(Spacer(1, 0.2 * cm))
    hr(story)

    section(story, '1. BORROWER AND COLLATERAL DETAILS',
        '<b>Borrower:</b> Sarvan Nair, S/O Suresh Nair, 44, MG Road, Ernakulam, Kerala – 682016. '
        'PAN: FNTPN4421M | Aadhaar: XXXX-XXXX-7821',
        f'<b>Gold Articles Pledged:</b> 22K gold jewellery, Net Weight: 52.3 grams',
        f'<b>Appraised Value:</b> INR {gold_value:,} (at INR 4,780 per gram on assessment date)',
        f'<b>LTV Ratio:</b> {int(ltv*100)}% | <b>Loan Amount Disbursed:</b> INR {principal:,}',
    )

    # [V1] No cooling-off  [V2] Ambiguous tenure  [V3] EMI on gold value
    section(story, '2. LOAN TERMS — GOLD FACILITY',
        f'<b>Loan Amount Disbursed:</b> INR {principal:,} (Rupees One Lakh Eighty Seven Thousand Five Hundred)',
        f'<b>Interest Rate:</b> {rate}% per annum',
        f'<b>Tenure [VIOLATION — AMBIGUOUS]:</b> 12 months OR on-demand bullet repayment, '
        f'whichever is earlier, at the Lender\'s discretion. '
        f'The Lender may call the loan at any time with 15-day notice.',
        f'<b>Monthly EMI (as stated) [VIOLATION V3]:</b> INR {inflated_emi:,.0f} per month. '
        f'<u>EMI is computed on appraised gold value INR {gold_value:,}, '
        f'NOT on disbursed amount INR {principal:,}.</u> '
        f'Correct EMI on disbursed amount = INR {correct_emi:,.0f}. '
        f'Overstatement = INR {inflated_emi - correct_emi:,.0f}/month ({deviation:.1f}%).',
        f'<b>Cooling-Off Period [VIOLATION V1]:</b> Not applicable for gold loan products. '
        f'Loan terms are final from the time of gold pledge and disbursement. '
        f'Sarvan Nair is not entitled to a cancellation window.',
    )

    section(story, '3. FEES AND CHARGES',
        f'<b>Processing Fee:</b> 1.5% of loan amount = INR {proc_fee:,.2f} (deducted at disbursement)',
        '<b>Gold Appraisal Fee:</b> INR 500 (non-refundable)',
        '<b>Safe Custody Charges:</b> INR 100 per month for secure storage of pledged gold',
        '<b>Valuation Revision Fee:</b> INR 300 if gold value falls and LTV rebalancing is triggered',
        '<b>Penal Interest:</b> 3% per month on overdue amount (compounded into principal)',
        '<b>Auction Preparation Fee:</b> INR 2,500 charged to Borrower if gold proceeds to auction',
    )

    # [V4] — Forced in-house insurance
    section(story, '4. MANDATORY GOLD INSURANCE [VIOLATION — FORCED IN-HOUSE]',
        f'<b>Insurance Coverage:</b> The pledged gold must be insured against loss, theft, and damage '
        f'for the duration of the loan.',
        f'<b>Premium:</b> INR {insurance:,} per annum (collected upfront at disbursement). '
        f'The Lender\'s in-house insurance partner, SuvaRNA Protect Ltd., is the sole authorised insurer. '
        f'<u>Third-party insurance is not accepted.</u> The Borrower — Sarvan Nair — has no option '
        f'to procure alternate coverage. Premium is non-refundable even on early foreclosure.',
        f'Insurance premium is charged on the appraised gold value (INR {gold_value:,}), '
        f'not on the loan amount disbursed (INR {principal:,}).',
    )

    # [V5] — Auction without court order
    section(story, '5. DEFAULT AND GOLD AUCTION — CRITICAL NOTICE', style=red_style,
        *[
        '⚠ DEFAULT CLAUSE: In the event Sarvan Nair fails to pay any EMI or repay the '
        'outstanding on demand, the following steps will be taken:',
        '<b>Step 1:</b> Notice issued via SMS/email (7 calendar days).',
        '<b>Step 2 [VIOLATION]:</b> If dues not cleared within 7 days of notice: '
        '<u>The Lender is authorised to proceed with public auction of the pledged gold WITHOUT '
        'obtaining a court order or decree.</u> This right is exercised under SARFAESI Act '
        '(as applicable to NBFCs) and the contractual lien created herein.',
        '<b>Step 3:</b> Auction proceeds will settle: (i) accrued interest, (ii) penal interest, '
        '(iii) auction fees, (iv) safe custody charges, (v) insurance premium, then '
        '(vi) principal outstanding. Any surplus will be returned to Sarvan Nair.',
        'The Borrower explicitly waives the right to contest the auction valuation or timing.',
        ]
    )

    # [V6] — BNPL 0% misrepresentation  [V7] — No KFS for BNPL
    section(story, '6. BNPL FACILITY TERMS [BUY NOW PAY LATER]',
        '<b>BNPL Credit Limit:</b> INR 25,000 (digital purchase facility linked to this loan account)',
        '<b>Promoted as:</b> "0% interest for 3 months!" on partner merchant platforms.',
        '<b>Actual Terms (see clause 6.4) [VIOLATION V6]:</b> Zero-interest period applies ONLY if the '
        'full BNPL outstanding is repaid within the promotional period AND the gold loan EMIs '
        'are paid on time. Any default on either facility voids the 0% offer retroactively.',
        '<b>Clause 6.4:</b> If 0% period is voided, interest at 36% per annum is charged on the '
        'BNPL amount from the date of first BNPL transaction (not from the date of default). '
        'This clause is binding regardless of whether it was disclosed at point-of-sale.',
        '<b>KFS for BNPL [VIOLATION V7]:</b> Not provided — see note at top of agreement.',
    )

    section(story, '7. DATA AND DIGITAL CONSENT',
        'For the BNPL facility, Sarvan Nair authorises access to: location data, UPI transaction '
        'history (read-only), and purchase pattern data for credit limit management.',
        'Data may be shared with partner merchants, affiliate lenders, and marketing entities '
        'as part of the BNPL ecosystem. Consent may not be revoked without closing the BNPL facility.',
    )

    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph('Borrower: Sarvan Nair', body_style))
    story.append(Paragraph('Borrower Signature: _______________________ Date: __________', body_style))
    story.append(Paragraph('Gold Appraiser Signature: _________________ Date: __________', body_style))
    story.append(Paragraph('Authorised Representative (SuvaRNA FinServ): ______________ Seal:', body_style))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        f'[AUDIT NOTE] borrower_name=Sarvan Nair | lender=SuvaRNA FinServ Pvt. Ltd. | '
        f'principal=187500 | interest_rate=18.0 | tenure=12 | kfs_present=False | '
        f'insurance_premium={insurance} | processing_fee={int(proc_fee)} | '
        f'prepayment_penalty_percent=0.0 | penal_interest_rate=36.0 (3%/month) | '
        f'emi_stated=₹{inflated_emi:,.2f} (on gold_value={gold_value}) | '
        f'correct_emi=₹{correct_emi:,.2f} (on principal={principal}) | '
        f'emi_deviation_percent={deviation:.2f} | '
        f'overcharge_per_month=₹{inflated_emi - correct_emi:,.2f} | '
        f'overcharge_total=₹{(inflated_emi - correct_emi) * tenure:,.2f} | '
        f'risk_category=HIGH | expected_violations=5-7',
        fine_style))

    doc.build(story)
    print(f'✅  Sample 5 (HIGH) — Sarvan Nair: {path}')
    return path


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print('\n🔨  Generating LoanGuard sample loan PDFs...\n')

    generate_sample_1()
    generate_sample_2()
    generate_sample_3()
    generate_sample_4()
    generate_sample_5()

    print('\n' + '=' * 72)
    print('✅  All 5 samples generated in:', OUTPUT_DIR)
    print('=' * 72)
    print()

    rows = [
        ('sample_1_critical_risk.pdf',     'Sarvan Kumar',         '🔴 CRITICAL', '7-8',
         'Penal stacking, APR hidden, data abuse, threats, no KFS'),
        ('sample_2_high_risk_homeloan.pdf','Sarvan Ramesh',        '🟠 HIGH',     '4-5',
         'No KFS, APR mismatch (+1.2%), spread discretion, hidden fees'),
        ('sample_3_low_risk_compliant.pdf','Sarvan Krishnamurthy', '🟢 LOW',      '0',
         'Fully RBI-compliant; KFS present; correct EMI & APR'),
        ('sample_4_credit_card_medium.pdf','Sarvan Malhotra',      '🟡 MEDIUM',   '3-4',
         'Auto limit increase, full-balance interest, GST misapplication'),
        ('sample_5_high_risk_goldloan.pdf','Sarvan Nair',          '🟠 HIGH',     '5-7',
         'EMI on gold value not disbursed, forced insurance, no BNPL KFS, auction w/o court'),
    ]

    print(f'{"File":<42} {"Borrower":<26} {"Risk":<12} {"Violations":<12} Key Flags')
    print('-' * 120)
    for filename, borrower, risk, violations, notes in rows:
        print(f'  {filename:<40} {borrower:<26} {risk:<12} {violations:<12} {notes}')

    print()
    print('Correct EMIs (for backend audit verification):')
    print(f'  Sample 1 (Sarvan Kumar):         ₹{calc_emi(500_000, 24, 36):,.0f}  '
          f'— stated ₹19,800 — deviation {(19800 - calc_emi(500_000, 24, 36)) / calc_emi(500_000, 24, 36) * 100:.2f}%')
    print(f'  Sample 2 (Sarvan Ramesh):         ₹{calc_emi(3_600_000, 8.75, 240):,.0f}  '
          f'— stated ₹31,800')
    print(f'  Sample 3 (Sarvan Krishnamurthy):  ₹{calc_emi(200_000, 12.5, 36):,.0f}  '
          f'— stated matches computed ✓')
    print(f'  Sample 5 (Sarvan Nair):')
    print(f'    Correct (on disbursed ₹1,87,500): ₹{calc_emi(187_500, 18, 12):,.0f}')
    print(f'    Stated  (on gold value ₹2,50,000): ₹{calc_emi(250_000, 18, 12):,.0f}')
    print(f'    Overcharge/month: ₹{calc_emi(250_000, 18, 12) - calc_emi(187_500, 18, 12):,.0f} '
          f'({(calc_emi(250_000, 18, 12) - calc_emi(187_500, 18, 12)) / calc_emi(187_500, 18, 12) * 100:.1f}%)')
    print()
    print('Fields embedded in each PDF for backend extraction:')
    print('  borrower_name, lender_name, principal, interest_rate, apr,')
    print('  emi_stated, tenure_months, processing_fee, insurance_premium,')
    print('  prepayment_penalty_percent, penal_interest_rate, kfs_present,')
    print('  risk_category, expected_violations — all in [AUDIT NOTE] footer.')
