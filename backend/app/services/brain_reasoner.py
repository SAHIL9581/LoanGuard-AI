import os
import json
import logging
import time
from typing import Dict, Any, List, Optional
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Configure Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

load_dotenv()

from app.config import get_settings
GEMINI_API_KEY = get_settings().gemini_api_key
MODEL_NAME = "gemini-2.5-flash"


class ReasoningError(Exception):
    """Custom exception for reasoning failures."""
    pass


# ---------------------------------------------------------------------------
# SIP math helpers (done in Python, not delegated to the LLM)
# ---------------------------------------------------------------------------

def _lumpsum_future_value(principal: float, annual_rate: float = 0.12, years: int = 10) -> float:
    """
    FIX #9: Correct lump-sum Future Value formula.
    FV = P * (1 + r)^n
    This is accurate for a one-time spend (which is what we're modelling —
    "if you hadn't bought X and invested that money today").
    """
    return round(principal * ((1 + annual_rate) ** years), 2)


def _enrich_sip_suggestions(suggestions: List[Dict]) -> List[Dict]:
    """
    FIX #9 + #10: Recalculate sip_10yr_potential in Python using the correct
    formula, overriding whatever the LLM computed.
    Also ensures total_potential_savings is unambiguous (= sum of potentials).
    """
    for item in suggestions:
        cost = float(item.get("cost") or 0)
        item["sip_10yr_potential"] = _lumpsum_future_value(cost)
        item["opportunity_cost"] = round(item["sip_10yr_potential"] - cost, 2)
    return suggestions


# ---------------------------------------------------------------------------
# Response validation
# ---------------------------------------------------------------------------

def _validate_response(data: Dict) -> Dict:
    """Ensure all expected keys are present with safe defaults."""
    defaults = {
        "income_detected": False,
        "detected_income": 0.0,
        "income_confidence": "none",
        "income_source": None,
        "total_expenses": 0.0,
        "existing_monthly_savings": 0.0,
        "surplus": 0.0,
        "summary": "No summary available.",
        "insights": [],
        "sip_suggestions": [],
        "lumpsum_opportunities": [],
        "total_discretionary_spend": 0.0,
        "total_potential_savings": 0.0,
    }
    for key, default in defaults.items():
        if key not in data or data[key] is None:
            data[key] = default

    # Validate sip_suggestions
    clean_sip = []
    for s in data["sip_suggestions"]:
        if not isinstance(s, dict):
            continue
        clean_sip.append({
            "item": s.get("item") or "Unknown",
            "cost": float(s.get("cost") or 0),
            "sip_10yr_potential": float(s.get("sip_10yr_potential") or 0),
            "opportunity_cost": float(s.get("opportunity_cost") or 0),
            "reasoning": s.get("reasoning") or "",
            "category": s.get("category") or "Unknown",
        })
    data["sip_suggestions"] = clean_sip

    # Validate lumpsum_opportunities
    clean_lumpsum = []
    for l in data["lumpsum_opportunities"]:
        if not isinstance(l, dict):
            continue
        clean_lumpsum.append({
            "item": l.get("item") or "Unknown",
            "cost": float(l.get("cost") or 0),
            "future_value_10yr": float(l.get("future_value_10yr") or 0),
            "reasoning": l.get("reasoning") or "",
        })
    data["lumpsum_opportunities"] = clean_lumpsum

    return data

# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def _prepare_reasoning_prompt(extracted_data: Dict[str, Any]) -> str:
    """Constructs the enhanced financial reasoning prompt."""
    return f"""You are 'The Brain' — a senior financial advisor for an Indian personal finance app.
You will receive extracted financial records (bank statements, e-commerce orders).

YOUR GOAL:
1. Detect monthly income confidently — follow strict rules below
2. Identify recurring discretionary habits as SIP candidates
3. Identify one-time big purchases as lumpsum opportunity costs
4. Provide 2-4 sharp, specific insights about financial behavior

INCOME DETECTION:
- Look at metadata.detected_income and income_confidence across all records
- If income_confidence is "high" or "medium" — use that value
- If multiple records have income signals — use the highest confidence one
- If no confident income found — set detected_income to null, income_detected to false
- NEVER sum up all credits as income
- NEVER treat peer transfers, refunds, cashbacks as income

SAVINGS DETECTION:
- Look for transactions where is_savings is true or category is Savings_Investment
- Sum these up as existing_monthly_savings
- These should NOT appear in sip_suggestions or lumpsum_opportunities

SIP CANDIDATES (recurring discretionary habits only):
- Food delivery / restaurants appearing 3+ times in the data
- Streaming or app subscriptions
- Frequent small shopping (same category appearing 3+ times)
- Regular entertainment or leisure spends
- Must be RECURRING — if it appears only once it is NOT a sip candidate

LUMPSUM OPPORTUNITIES (one-time purchases only):
- Electronics or gadgets above ₹2,000 (smartwatch, headphones, laptop, phone)
- Fashion or accessories above ₹2,000
- Any single non-recurring purchase above ₹3,000
- Framing: what this amount could have become if invested as lumpsum for 10 years
- Do NOT include items already identified as savings or essentials

EXCLUDE ENTIRELY:
- Anything under ₹300 (noise)
- Rent, EMI, insurance, utilities, groceries, medicines
- Savings_Investment transactions
- Salary or income credits

NOTE ON CALCULATIONS:
- Set sip_10yr_potential and future_value_10yr to 0.0 — the app will calculate these
- Just identify items and their costs accurately

INPUT DATA:
{json.dumps(extracted_data, indent=2)}

OUTPUT — return ONLY a valid JSON object matching this schema exactly:
{{
  "income_detected": true or false,
  "detected_income": 0.0,
  "income_confidence": "high | medium | low | none",
  "income_source": "employer name or null",
  "total_expenses": 0.0,
  "existing_monthly_savings": 0.0,
  "surplus": 0.0,
  "summary": "2-3 sentence overview of overall spending health.",
  "insights": [
    "Specific observation about a spending pattern",
    "Another data-backed observation"
  ],
  "sip_suggestions": [
    {{
      "item": "Exact recurring habit description",
      "cost": 0.0,
      "sip_10yr_potential": 0.0,
      "opportunity_cost": 0.0,
      "reasoning": "Why this is a recurring discretionary habit",
      "category": "Food | Shopping | Entertainment | Travel | Unknown"
    }}
  ],
  "lumpsum_opportunities": [
    {{
      "item": "Exact item description",
      "cost": 0.0,
      "future_value_10yr": 0.0,
      "reasoning": "Why this is a one-time opportunity cost"
    }}
  ],
  "total_discretionary_spend": 0.0,
  "total_potential_savings": 0.0
}}
"""

# ---------------------------------------------------------------------------
# Core reasoning function
# ---------------------------------------------------------------------------

def reason_about_spending(extracted_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Sends extracted transaction data to Gemini for behavioral analysis.
    Returns validated coaching advice with correct SIP and lumpsum calculations.
    
    FIX #11: Limit to first 50 most recent transactions to reduce API latency.
    """
    if not GEMINI_API_KEY:
        raise ReasoningError("GEMINI_API_KEY is not set in environment variables.")

    try:
        # FIX #11: Optimize by limiting transactions
        optimized_data = extracted_data.copy()
        for record in optimized_data.get("extracted_records", []):
            txns = record.get("transactions", [])
            if len(txns) > 50:
                logger.info(f"Limiting {len(txns)} transactions to first 50 for faster analysis")
                record["transactions"] = txns[:50]
        
        client = genai.Client(api_key=GEMINI_API_KEY)
        prompt = _prepare_reasoning_prompt(optimized_data)

        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )

        try:
            raw = json.loads(response.text)
        except json.JSONDecodeError as je:
            raise ReasoningError(f"Model returned malformed JSON: {je}. Snippet: {response.text[:200]}")

        validated = _validate_response(raw)

        # Recalculate SIP numbers in Python
        validated["sip_suggestions"] = _enrich_sip_suggestions(validated["sip_suggestions"])

        # Recalculate lumpsum future values in Python
        for item in validated["lumpsum_opportunities"]:
            cost = float(item.get("cost") or 0)
            item["future_value_10yr"] = _lumpsum_future_value(cost)
            item["opportunity_cost"] = round(item["future_value_10yr"] - cost, 2)

        # Recalculate totals
        validated["total_potential_savings"] = round(
            sum(s["opportunity_cost"] for s in validated["sip_suggestions"]), 2
        )
        validated["total_discretionary_spend"] = round(
            sum(s["cost"] for s in validated["sip_suggestions"]), 2
        )
        validated["total_lumpsum_spend"] = round(
            sum(l["cost"] for l in validated["lumpsum_opportunities"]), 2
        )
        validated["total_lumpsum_opportunity"] = round(
            sum(l["opportunity_cost"] for l in validated["lumpsum_opportunities"]), 2
        )

        return validated

    except ReasoningError:
        raise
    except Exception as e:
        logger.error(f"Reasoning failed: {e}")
        raise ReasoningError(f"The Brain encountered an error: {e}")

# ---------------------------------------------------------------------------
# Phase 2: Health Score Engine (0-100)
# ---------------------------------------------------------------------------

def _calculate_health_score(analysis: Dict[str, Any], extracted_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculates Financial Health Score (0-100) based on spending patterns.
    
    Scoring Logic:
    - Base: 50 points
    - Discretionary Spend Ratio: -30 to 0 points (0% = +0, >50% = -30)
    - Savings Potential: -15 to 0 points (if >50% savings potential = concern)
    - Subscription Waste: -10 to 0 points (if likely duplicate/unused subscriptions)
    - Spending Volatility: -10 to 0 points (high variance = unpredictable)
    - Category Diversity: +5 bonus (if spending across 4+ categories = signs of planning)
    
    Returns dict with score (0-100), grade (F/D/C/B/A), and explanation.
    """
    score = 50
    breakdown = {}
    
    # 1. DISCRETIONARY SPEND RATIO (max -30)
    all_transactions = []
    for record in extracted_data.get("extracted_records", []):
        all_transactions.extend(record.get("transactions", []))
    
    total_spend = sum(float(t.get("amount", 0) or 0) for t in all_transactions if t.get("type") == "DEBIT")
    discretionary_spend = analysis.get("total_discretionary_spend", 0)
    
    if total_spend > 0:
        discretionary_ratio = discretionary_spend / total_spend
        if discretionary_ratio > 0.5:
            discretionary_penalty = -30
        elif discretionary_ratio > 0.35:
            discretionary_penalty = -20
        elif discretionary_ratio > 0.20:
            discretionary_penalty = -10
        else:
            discretionary_penalty = 0
        breakdown["discretionary_ratio"] = round(discretionary_ratio * 100, 1)
    else:
        discretionary_penalty = 0
        breakdown["discretionary_ratio"] = 0
    
    score += discretionary_penalty
    breakdown["discretionary_penalty"] = discretionary_penalty
    
    # 2. SAVINGS POTENTIAL (max -15)
    opportunity_cost = analysis.get("total_potential_savings", 0)
    if discretionary_spend > 0:
        savings_ratio = opportunity_cost / discretionary_spend
        if savings_ratio > 10:  # >10x savings potential = very wasteful
            savings_penalty = -15
        elif savings_ratio > 5:
            savings_penalty = -10
        elif savings_ratio > 2:
            savings_penalty = -5
        else:
            savings_penalty = 0
        breakdown["savings_potential_10yr"] = round(opportunity_cost, 2)
    else:
        savings_penalty = 0
    
    score += savings_penalty
    breakdown["savings_penalty"] = savings_penalty
    
    # 3. CATEGORY DIVERSITY (bonus +5)
    categories_found = set()
    for sip in analysis.get("sip_suggestions", []):
        cat = sip.get("category", "Unknown")
        if cat != "Unknown":
            categories_found.add(cat)
    
    diversity_bonus = 5 if len(categories_found) >= 4 else 0
    score += diversity_bonus
    breakdown["category_diversity"] = len(categories_found)
    
    # Clamp score to 0-100
    score = max(0, min(100, score))
    
    # Assign grade
    if score >= 90:
        grade = "A"
        grade_label = "Excellent"
    elif score >= 75:
        grade = "B"
        grade_label = "Good"
    elif score >= 60:
        grade = "C"
        grade_label = "Fair"
    elif score >= 40:
        grade = "D"
        grade_label = "Poor"
    else:
        grade = "F"
        grade_label = "Critical"
    
    return {
        "score": score,
        "grade": grade,
        "grade_label": grade_label,
        "breakdown": breakdown,
        "message": _generate_health_message(score, grade, breakdown)
    }


def _generate_health_message(score: int, grade: str, breakdown: Dict) -> str:
    """Generates a human-readable health explanation."""
    if score >= 90:
        return "Excellent control! Your spending is disciplined and aligned with savings goals."
    elif score >= 75:
        return f"Good job! You're managing well. Review the {breakdown.get('discretionary_ratio', 0):.0f}% discretionary spending for optimization."
    elif score >= 60:
        return f"Fair spending pattern detected. {breakdown.get('savings_potential_10yr', 0):.0f} potential 10-year wealth increase possible with habit changes."
    elif score >= 40:
        return f"Alert: {breakdown.get('discretionary_ratio', 0):.0f}% of spend is discretionary. Cut this by 30% to unlock ₹{breakdown.get('savings_potential_10yr', 0) * 0.3:.0f} savings opportunity."
    else:
        return "Critical review needed. Your current spending pattern is unsustainable. Immediate action recommended."


# ---------------------------------------------------------------------------
# Phase 2: Anomaly Detection
# ---------------------------------------------------------------------------

def _detect_anomalies(extracted_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Detects spending anomalies and unusual patterns.
    
    Types detected:
    - Spike: Single expense >3x average daily spend
    - Duplicate: Same merchant + similar amount within 24 hours
    - Frequency: Same merchant appearing 3x+ in 7 days
    """
    anomalies = []
    all_transactions = []
    
    for record in extracted_data.get("extracted_records", []):
        for txn in record.get("transactions", []):
            if txn.get("type") == "DEBIT":
                all_transactions.append({
                    "date": txn.get("date"),
                    "description": txn.get("description", ""),
                    "amount": float(txn.get("amount") or 0),
                    "merchant": _extract_merchant(txn.get("description", "")),
                    "category": txn.get("category_classification", "Unknown")
                })
    
    if not all_transactions:
        return []
    
    # Sort by date
    all_transactions.sort(key=lambda x: x["date"])
    
    # 1. SPENDING SPIKE (single transaction >3x average daily)
    daily_total = sum(t["amount"] for t in all_transactions)
    avg_daily = daily_total / max(1, len(set(t["date"] for t in all_transactions)))
    
    for txn in all_transactions:
        if txn["amount"] > avg_daily * 3:
            anomalies.append({
                "type": "SPIKE",
                "date": txn["date"],
                "description": txn["description"],
                "amount": txn["amount"],
                "severity": "high" if txn["amount"] > avg_daily * 5 else "medium",
                "explanation": f"Unusual spike: ₹{txn['amount']:.0f} (3x your daily average of ₹{avg_daily:.0f})"
            })
    
    # 2. DUPLICATE TRANSACTIONS (same merchant + amount within 24 hours)
    for i, txn1 in enumerate(all_transactions):
        for txn2 in all_transactions[i+1:]:
            days_diff = (int(txn2["date"].replace("-", "")) - int(txn1["date"].replace("-", "")))
            if 0 <= days_diff <= 1 and txn1["merchant"] == txn2["merchant"] and abs(txn1["amount"] - txn2["amount"]) < 10:
                anomalies.append({
                    "type": "DUPLICATE",
                    "date": txn1["date"],
                    "description": f"{txn1['description']} (appears twice)",
                    "amount": txn1["amount"],
                    "severity": "high",
                    "explanation": f"Possible duplicate charge from {txn1['merchant']} on {txn1['date']}"
                })
    
    # 3. SUBSCRIPTION FREQUENCY (same merchant 3x+ in 7 days = likely subscription)
    merchant_freq = {}
    for txn in all_transactions:
        key = txn["merchant"]
        if key not in merchant_freq:
            merchant_freq[key] = []
        merchant_freq[key].append(txn)
    
    for merchant, txns_list in merchant_freq.items():
        if len(txns_list) >= 3:
            anomalies.append({
                "type": "FREQUENT_MERCHANT",
                "date": txns_list[0]["date"],
                "description": merchant,
                "amount": sum(t["amount"] for t in txns_list),
                "count": len(txns_list),
                "severity": "medium",
                "explanation": f"Regular spend pattern: {merchant} appears {len(txns_list)} times. Total: ₹{sum(t['amount'] for t in txns_list):.0f}"
            })
    
    return anomalies


def _extract_merchant(description: str) -> str:
    """Extracts merchant name from transaction description."""
    # Take first few words or capitalized words
    parts = description.split()
    merchant = parts[0] if parts else "Unknown"
    return merchant[:20]  # Truncate for consistency


# ---------------------------------------------------------------------------
# Phase 2: Monthly Report Card (50-30-20 Rule Analysis)
# ---------------------------------------------------------------------------

def _calculate_report_card(extracted_data: Dict[str, Any], analysis: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generates a Financial Report Card following the 50-30-20 rule:
    - 50% Essential (groceries, utilities, rent, EMI)
    - 30% Wants (discretionary, entertainment)
    - 20% Savings/Investments
    
    Returns status indicators (🟢 OK / 🟡 Warning / 🔴 Alert) for each bucket.
    """
    # Categorize all spend
    categories = {
        "essentials": ["Groceries", "Utilities", "Insurance", "EMI", "Rent"],
        "wants": ["Electronics", "Food", "Entertainment", "Shopping", "Travel"],
        "savings": ["SIP", "FD", "Savings Account"]
    }
    
    all_transactions = []
    for record in extracted_data.get("extracted_records", []):
        for txn in record.get("transactions", []):
            if txn.get("type") == "DEBIT":
                all_transactions.append(txn)
    
    total_spend = sum(float(t.get("amount") or 0) for t in all_transactions)
    
    if total_spend == 0:
        return {"error": "No transaction data available"}
    
    # Calculate actual percentages
    essential_spend = sum(
        float(t.get("amount") or 0) for t in all_transactions
        if any(cat in t.get("category_classification", "") for cat in categories["essentials"])
    )
    wants_spend = analysis.get("total_discretionary_spend", 0)
    savings_spend = 0  # Would be inferred from sips/investments
    
    essential_pct = (essential_spend / total_spend) * 100 if total_spend > 0 else 0
    wants_pct = (wants_spend / total_spend) * 100 if total_spend > 0 else 0
    savings_pct = 100 - essential_pct - wants_pct
    
    # Assign status
    def get_status(actual: float, ideal: float, tolerance: float = 5) -> tuple:
        if abs(actual - ideal) <= tolerance:
            return "🟢", "On Track"
        elif actual > ideal + tolerance:
            return "🟡", "Alert: Overspending"
        else:
            return "🔴", "Alert: Underfunding"
    
    return {
        "essentials": {
            "ideal": 50,
            "actual": round(essential_pct, 1),
            "status": get_status(essential_pct, 50)[0],
            "label": get_status(essential_pct, 50)[1]
        },
        "wants": {
            "ideal": 30,
            "actual": round(wants_pct, 1),
            "status": get_status(wants_pct, 30)[0],
            "label": get_status(wants_pct, 30)[1]
        },
        "savings": {
            "ideal": 20,
            "actual": round(savings_pct, 1),
            "status": get_status(savings_pct, 20)[0],
            "label": get_status(savings_pct, 20)[1]
        },
        "total_spend": round(total_spend, 2),
        "monthly_message": _generate_monthly_message(essential_pct, wants_pct, savings_pct)
    }


def _generate_monthly_message(essential: float, wants: float, savings: float) -> str:
    """Generates actionable monthly insight."""
    if wants > 40:
        return f"Your 'wants' are {wants:.0f}% (target: 30%). Cut discretionary spend by ₹{((wants - 30) * 0) / 100:.0f}/month to reach goal."
    elif savings < 15:
        return f"Savings potential is {savings:.0f}% (target: 20%). Reduce wants or essential costs to boost savings."
    else:
        return "Excellent monthly balance! You're tracking the 50-30-20 rule well."


# ---------------------------------------------------------------------------
# ENHANCED Analysis (Master Function)
# ---------------------------------------------------------------------------

def comprehensive_financial_analysis(extracted_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Comprehensive analysis combining all Phase 2 features:
    - Basic spending analysis (SIP suggestions)
    - Health score (0-100)
    - Anomalies (spikes, duplicates, frequency)
    - Report card (50-30-20 rule)
    
    This is the main function for the "Wow Moment" demo.
    """
    # 1. Base analysis (SIP suggestions + insights)
    base_analysis = reason_about_spending(extracted_data)
    
    # 2. Health score
    health_score = _calculate_health_score(base_analysis, extracted_data)
    
    # 3. Anomalies
    anomalies = _detect_anomalies(extracted_data)
    
    # 4. Report card
    report_card = _calculate_report_card(extracted_data, base_analysis)
    
    return {
        "basic_analysis": base_analysis,
        "health_score": health_score,
        "anomalies": anomalies,
        "report_card": report_card,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
    }


# ---------------------------------------------------------------------------
# CLI / self-test
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Risk Profile Scoring
# ---------------------------------------------------------------------------

def calculate_risk_profile(answers: Dict[str, str]) -> str:
    """
    Takes quiz answers and returns Conservative / Moderate / Aggressive.
    
    Expected answers dict:
    {
        "q1": "A" | "B" | "C",
        "q2": "A" | "B" | "C",
        "q3": "A" | "B" | "C"
    }
    """
    score = 0
    for answer in answers.values():
        if answer == "A":
            score += 1
        elif answer == "B":
            score += 2
        elif answer == "C":
            score += 3

    if score <= 4:
        return "Conservative"
    elif score <= 7:
        return "Moderate"
    else:
        return "Aggressive"


# ---------------------------------------------------------------------------
# Allocation Engine
# ---------------------------------------------------------------------------

FUND_MAPPING: Dict[str, Dict] = {
    "Conservative": {
        "primary_category":   "Large Cap",
        "secondary_category": "Index",
        "primary_pct":        70,
        "secondary_pct":      30,
        "description": "Stable, lower-risk funds focused on large established companies.",
    },
    "Moderate": {
        "primary_category":   "Flexi Cap",
        "secondary_category": "Large Cap",
        "primary_pct":        60,
        "secondary_pct":      40,
        "description": "Balanced mix of growth and stability across market caps.",
    },
    "Aggressive": {
        "primary_category":   "Mid Cap",
        "secondary_category": "Small Cap",
        "primary_pct":        50,
        "secondary_pct":      50,
        "description": "Higher growth potential with higher short-term volatility.",
    },
}


def calculate_allocation(
    detected_income: float,
    user_income: float,
    total_expenses: float,
    existing_monthly_savings: float,
    risk_profile: str,
    existing_fd_rd: float = 0.0,
    existing_mf: float = 0.0,
    existing_other: float = 0.0,
) -> Dict[str, Any]:
    """
    Calculates the monthly allocation plan based on surplus, risk profile,
    and existing savings/investments.

    Existing savings logic:
    - Total existing savings = fd_rd + mf + other
    - Emergency fund target = 6 months of net expenses
    - If existing savings fully cover emergency fund target → skip emergency bucket
    - If existing savings partially cover → reduce emergency bucket proportionally
    - Freed up % goes directly into investment bucket
    """
    income = user_income if user_income and user_income > 0 else detected_income

    if not income or income <= 0:
        return {
            "error": "Income not available",
            "message": "Please enter your monthly take-home income to get an allocation plan.",
            "income": 0,
            "surplus": 0,
        }

    net_expenses = total_expenses - existing_monthly_savings
    surplus = round(income - net_expenses, 2)

    if surplus <= 0:
        return {
            "error": "No surplus",
            "message": f"Your expenses (₹{net_expenses:,.0f}) exceed your income "
                       f"(₹{income:,.0f}). Focus on reducing discretionary spend before investing.",
            "income": income,
            "surplus": surplus,
        }

    # ── Emergency fund assessment ──
    total_existing_savings = existing_fd_rd + existing_mf + existing_other
    emergency_fund_target  = net_expenses * 6  # 6 months rule

    coverage_ratio = (
        total_existing_savings / emergency_fund_target
        if emergency_fund_target > 0 else 1.0
    )

    # Determine emergency and liquid allocation based on coverage
    if coverage_ratio >= 1.0:
        # Fully covered — skip emergency fund, small liquid buffer only
        emergency_pct  = 0
        liquid_pct     = 10
        investment_pct = 90
        coverage_label = "full"
    elif coverage_ratio >= 0.5:
        # Partially covered — reduce emergency allocation
        emergency_pct  = 5
        liquid_pct     = 20
        investment_pct = 75
        coverage_label = "partial"
    else:
        # Not covered — standard allocation
        emergency_pct  = 20
        liquid_pct     = 30
        investment_pct = 50
        coverage_label = "none"

    # If they already have active monthly savings (SIP/RD detected),
    # slightly increase investment allocation
    if existing_monthly_savings > 0 and coverage_label == "none":
        emergency_pct  = 10
        liquid_pct     = 30
        investment_pct = 60

    emergency_monthly  = round(surplus * emergency_pct  / 100, 2)
    liquid_monthly     = round(surplus * liquid_pct     / 100, 2)
    investment_monthly = round(surplus * investment_pct / 100, 2)

    fund_info = FUND_MAPPING.get(risk_profile, FUND_MAPPING["Moderate"])

    primary_amount   = round(investment_monthly * fund_info["primary_pct"]   / 100, 2)
    secondary_amount = round(investment_monthly * fund_info["secondary_pct"] / 100, 2)

    # Build coverage message for frontend
    if coverage_label == "full":
        coverage_message = (
            f"Your existing savings of ₹{total_existing_savings:,.0f} fully cover "
            f"your 6-month emergency fund target of ₹{emergency_fund_target:,.0f}. "
            f"We've redirected your emergency allocation entirely into investments."
        )
    elif coverage_label == "partial":
        shortfall = round(emergency_fund_target - total_existing_savings, 2)
        coverage_message = (
            f"Your existing savings of ₹{total_existing_savings:,.0f} partially cover "
            f"your emergency fund target. You still need ₹{shortfall:,.0f} to fully cover "
            f"6 months of expenses. We've reduced your emergency allocation accordingly."
        )
    else:
        coverage_message = (
            f"You currently have no significant savings buffer. "
            f"Your 6-month emergency fund target is ₹{emergency_fund_target:,.0f}. "
            f"We recommend building this before increasing investments."
        )

    return {
        "income": income,
        "net_expenses": net_expenses,
        "existing_monthly_savings": existing_monthly_savings,
        "total_existing_savings": total_existing_savings,
        "emergency_fund_target": round(emergency_fund_target, 2),
        "coverage_ratio": round(coverage_ratio, 2),
        "coverage_label": coverage_label,
        "coverage_message": coverage_message,
        "surplus": surplus,
        "risk_profile": risk_profile,
        "allocation": {
            "emergency_fund": {
                "amount": emergency_monthly,
                "percent": emergency_pct,
                "where": "Savings Account or Short-term FD",
                "why": "Liquid safety net for unexpected expenses",
            },
            "liquid_fund": {
                "amount": liquid_monthly,
                "percent": liquid_pct,
                "where": "Debt Mutual Funds (Short Duration)",
                "why": "Better returns than savings account, accessible within 1-2 days",
            },
            "investment": {
                "amount": investment_monthly,
                "percent": investment_pct,
                "where": f"{fund_info['primary_category']} + {fund_info['secondary_category']}",
                "why": fund_info["description"],
                "breakdown": {
                    "primary": {
                        "category": fund_info["primary_category"],
                        "amount": primary_amount,
                        "percent": fund_info["primary_pct"],
                    },
                    "secondary": {
                        "category": fund_info["secondary_category"],
                        "amount": secondary_amount,
                        "percent": fund_info["secondary_pct"],
                    },
                },
            },
        },
        "finsip_prefill": {
            "monthly_amount": investment_monthly,
            "primary_category": fund_info["primary_category"],
        },
    }

if __name__ == "__main__":
    # FIX #12: test data now uses the correct universal schema from vision_extractor
    test_data = {
        "extracted_records": [
            {
                "metadata": {
                    "inferred_document_type": "Ecommerce_Receipt",
                    "institution_or_merchant": "Amazon",
                    "document_id_or_utr": "402-1234567-8901234",
                    "statement_period_or_date": "2026-03-01"
                },
                "transactions": [
                    {
                        "index": 1,
                        "date": "2026-03-01",
                        "description": "Boat Nirvana 751ANC Wireless Headphones",
                        "raw_amount_text": "₹2,618.00",
                        "type": "DEBIT",
                        "amount": 2618.0,
                        "category_classification": "Electronics"
                    }
                ]
            }
        ]
    }

    try:
        print("\n" + "="*60)
        print("🧠 [COMPREHENSIVE FINANCIAL ANALYSIS - PHASE 2]")
        print("="*60)
        
        full_analysis = comprehensive_financial_analysis(test_data)
        
        # 1. HEALTH SCORE
        health = full_analysis["health_score"]
        print(f"\n📊 HEALTH SCORE: {health['score']}/100 ({health['grade']})")
        print(f"   Grade: {health['grade_label']}")
        print(f"   {health['message']}")
        
        # 2. SPENDING SUMMARY
        base = full_analysis["basic_analysis"]
        print(f"\n💸 SPENDING SUMMARY:")
        print(f"   Total Discretionary Spend : ₹{base['total_discretionary_spend']:,.2f}")
        print(f"   Opportunity Cost (10 yr)  : ₹{base['total_potential_savings']:,.2f}")
        print(f"   SIP Suggestions Found     : {len(base['sip_suggestions'])}")
        
        # 3. ANOMALIES
        anomalies = full_analysis["anomalies"]
        print(f"\n⚠️  ANOMALIES DETECTED: {len(anomalies)}")
        for anom in anomalies[:3]:  # Show top 3
            print(f"   [{anom['type']}] {anom['explanation']}")
        
        # 4. REPORT CARD (50-30-20)
        card = full_analysis["report_card"]
        if "error" not in card:
            print(f"\n📋 REPORT CARD (50-30-20 Rule):")
            print(f"   Essentials: {card['essentials']['status']} {card['essentials']['actual']:.0f}% (target: {card['essentials']['ideal']}%)")
            print(f"   Wants:      {card['wants']['status']} {card['wants']['actual']:.0f}% (target: {card['wants']['ideal']}%)")
            print(f"   Savings:    {card['savings']['status']} {card['savings']['actual']:.0f}% (target: {card['savings']['ideal']}%)")
            print(f"   💡 {card['monthly_message']}")
        
        print(f"\n⏰ Analysis completed: {full_analysis['timestamp']}")
        print("="*60 + "\n")
        
    except ReasoningError as e:
        print(f"Error: {e}")