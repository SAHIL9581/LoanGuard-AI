"""
SIP Intelligence API
─────────────────────────────────────────
Endpoints:
  GET  /api/sip/top-funds          → dynamic top funds from full AMFI list
  GET  /api/sip/fund/{code}        → full fund detail + NAV history
  POST /api/sip/predict            → Monte Carlo SIP projection (P10/P50/P90)
"""

import asyncio
import math
import time
from datetime import datetime, timedelta
from typing import Optional

import httpx
import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from loguru import logger

router = APIRouter(prefix="/api/sip", tags=["sip"])

MFAPI_BASE = "https://api.mfapi.in/mf"

# ─────────────────────────────────────────────
# Category keyword map
# Maps your UI display name → keywords found in mfapi scheme_category
# ─────────────────────────────────────────────
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Large Cap":  ["large cap"],
    "Mid Cap":    ["mid cap"],
    "Small Cap":  ["small cap"],
    "Flexi Cap":  ["flexi cap", "multi cap"],
    "Index":      ["index fund", "index"],
    "ELSS":       ["elss", "tax saver", "equity linked"],
    "Sectoral":   ["sectoral", "thematic"],
}

# Risk mapping based on category
CATEGORY_RISK: dict[str, str] = {
    "Large Cap":  "Moderate",
    "Mid Cap":    "High",
    "Small Cap":  "Very High",
    "Flexi Cap":  "Moderate",
    "Index":      "Moderate",
    "ELSS":       "High",
    "Sectoral":   "Very High",
}

# How many funds to fetch NAV data for per category (cap for performance)
FETCH_LIMIT = 30
# How many to return after ranking
RETURN_LIMIT = 20
# Max concurrent NAV fetches
SEMAPHORE_LIMIT = 10

# ─────────────────────────────────────────────
# In-memory cache
# ─────────────────────────────────────────────
_cache: dict = {}
CACHE_TTL_SEC     = 3600   # 1 hour for NAV data
CACHE_TTL_LIST    = 21600  # 6 hours for master fund list


def _cache_get(key: str):
    entry = _cache.get(key)
    if entry and (time.time() - entry["ts"]) < entry.get("ttl", CACHE_TTL_SEC):
        return entry["data"]
    return None


def _cache_set(key: str, data, ttl: int = CACHE_TTL_SEC):
    _cache[key] = {"data": data, "ts": time.time(), "ttl": ttl}


# ─────────────────────────────────────────────
# Normalizer — makes category comparison format-agnostic
# "Large Cap" / "large-cap" / "largecap" → "largecap"
# ─────────────────────────────────────────────
def _norm(s: str) -> str:
    return s.lower().replace('-', '').replace(' ', '')


# ─────────────────────────────────────────────
# Fetch master fund list from mfapi.in
# Returns: [{"schemeCode": 120503, "schemeName": "..."}, ...]
# ─────────────────────────────────────────────
async def _fetch_all_schemes() -> list[dict]:
    cached = _cache_get("all_schemes")
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(MFAPI_BASE)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch scheme list from mfapi.in")
        data = resp.json()

    _cache_set("all_schemes", data, ttl=CACHE_TTL_LIST)
    logger.info(f"Fetched master scheme list: {len(data)} schemes")
    return data


# ─────────────────────────────────────────────
# Filter schemes by category keyword + only
# keep Direct Plan Growth (cleanest NAV series)
# ─────────────────────────────────────────────
def _filter_schemes_by_name(
    all_schemes: list[dict],
    category: Optional[str],
    limit: int = FETCH_LIMIT,
) -> list[dict]:
    results = []
    for s in all_schemes:
        name: str = s.get("schemeName", "")
        name_lower = name.lower()

        # Only Direct Plan Growth — avoids duplicate NAV series
        if "direct" not in name_lower:
            continue
        if "growth" not in name_lower:
            continue
        # Skip dividend/IDCW variants
        if any(x in name_lower for x in ["idcw", "dividend", "bonus", "annual", "monthly", "weekly", "quarterly"]):
            continue

        if category and category != "All":
            keywords = CATEGORY_KEYWORDS.get(category, [_norm(category)])
            if not any(kw in name_lower for kw in keywords):
                continue

        results.append(s)
        if len(results) >= limit:
            break

    return results


# ─────────────────────────────────────────────
# Detect category from scheme_category string
# e.g. "Equity Scheme - Large Cap Fund" → "Large Cap"
# ─────────────────────────────────────────────
def _detect_category(scheme_category: str) -> str:
    sc_lower = scheme_category.lower()
    for display_name, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in sc_lower for kw in keywords):
            return display_name
    return "Other"


# ─────────────────────────────────────────────
# Fetch single fund detail (NAV history + meta)
# ─────────────────────────────────────────────
async def _fetch_fund(scheme_code: str) -> dict:
    cached = _cache_get(f"fund_{scheme_code}")
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{MFAPI_BASE}/{scheme_code}")
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"mfapi.in returned {resp.status_code} for {scheme_code}")
        data = resp.json()

    _cache_set(f"fund_{scheme_code}", data)
    return data


# ─────────────────────────────────────────────
# NAV helpers
# ─────────────────────────────────────────────
def _parse_navs(raw_data: list[dict]) -> list[tuple[datetime, float]]:
    parsed = []
    for entry in raw_data:
        try:
            d = datetime.strptime(entry["date"], "%d-%m-%Y")
            n = float(entry["nav"])
            parsed.append((d, n))
        except (ValueError, KeyError):
            continue
    parsed.sort(key=lambda x: x[0])
    return parsed


def _cagr(start_nav: float, end_nav: float, years: float) -> Optional[float]:
    if start_nav <= 0 or years <= 0:
        return None
    return round(((end_nav / start_nav) ** (1 / years) - 1) * 100, 2)


def _get_nav_at_offset(navs: list[tuple[datetime, float]], years_back: float) -> Optional[float]:
    if not navs:
        return None
    target = navs[-1][0] - timedelta(days=int(years_back * 365))
    for d, n in navs:
        if d >= target:
            return n
    return None


def _compute_returns(navs: list[tuple[datetime, float]]) -> dict:
    if not navs:
        return {}
    latest = navs[-1][1]
    return {
        "nav_current": round(latest, 4),
        "cagr_1y": _cagr(_get_nav_at_offset(navs, 1) or latest, latest, 1),
        "cagr_3y": _cagr(_get_nav_at_offset(navs, 3) or latest, latest, 3),
        "cagr_5y": _cagr(_get_nav_at_offset(navs, 5) or latest, latest, 5),
    }


# ─────────────────────────────────────────────
# Monte Carlo Engine
# ─────────────────────────────────────────────
def _monte_carlo_sip(
    navs: list[tuple[datetime, float]],
    monthly_amount: float,
    years: int,
    simulations: int = 1000,
) -> dict:
    if len(navs) < 60:
        raise HTTPException(status_code=422, detail="Insufficient NAV history for simulation")

    nav_values   = np.array([n for _, n in navs], dtype=float)
    log_returns  = np.diff(np.log(nav_values))
    daily_mean   = float(np.mean(log_returns))
    daily_std    = float(np.std(log_returns))
    monthly_mean = daily_mean * 22
    monthly_std  = daily_std  * math.sqrt(22)

    n_months       = years * 12
    total_invested = monthly_amount * n_months

    rng             = np.random.default_rng(seed=42)
    monthly_returns = rng.normal(loc=monthly_mean, scale=monthly_std, size=(simulations, n_months))

    corpus = np.zeros((simulations, n_months))
    for m in range(n_months):
        prev = corpus[:, m - 1] if m > 0 else np.zeros(simulations)
        corpus[:, m] = (prev + monthly_amount) * np.exp(monthly_returns[:, m])

    p10 = np.percentile(corpus, 10, axis=0).tolist()
    p50 = np.percentile(corpus, 50, axis=0).tolist()
    p90 = np.percentile(corpus, 90, axis=0).tolist()
    invested_line = [monthly_amount * (m + 1) for m in range(n_months)]
    prob_profit   = float(np.mean(corpus[:, -1] > total_invested) * 100)

    return {
        "monthly_amount":           monthly_amount,
        "years":                    years,
        "n_months":                 n_months,
        "total_invested":           round(total_invested, 2),
        "simulations":              simulations,
        "monthly_mean_pct":         round(monthly_mean * 100, 4),
        "monthly_std_pct":          round(monthly_std  * 100, 4),
        "probability_of_profit_pct": round(prob_profit, 1),
        "summary": {
            "pessimistic":      round(p10[-1], 2),
            "expected":         round(p50[-1], 2),
            "optimistic":       round(p90[-1], 2),
            "gain_pessimistic": round(p10[-1] - total_invested, 2),
            "gain_expected":    round(p50[-1] - total_invested, 2),
            "gain_optimistic":  round(p90[-1] - total_invested, 2),
        },
        "chart_data": [
            {
                "month":    m + 1,
                "invested": round(invested_line[m], 2),
                "p10":      round(p10[m], 2),
                "p50":      round(p50[m], 2),
                "p90":      round(p90[m], 2),
            }
            for m in range(n_months)
        ],
    }


# ─────────────────────────────────────────────
# Pydantic schemas
# ─────────────────────────────────────────────
class PredictRequest(BaseModel):
    scheme_code: str
    monthly_amount: float
    years: int = 10
    simulations: int = 1000


# ─────────────────────────────────────────────
# Endpoint 1 – Top funds list (DYNAMIC)
# ─────────────────────────────────────────────
@router.get("/top-funds", summary="Top performing SIPs with historical returns")
async def get_top_funds(
    category: Optional[str] = Query(None, description="Filter by category e.g. 'Large Cap'"),
    limit: int = Query(RETURN_LIMIT, ge=5, le=50, description="Number of top funds to return"),
):
    """
    Dynamically fetches the full AMFI fund list, filters by category,
    fetches NAV data concurrently (rate-limited), computes CAGR,
    and returns the top N funds ranked by 3Y CAGR.
    """
    # 1. Get master scheme list
    all_schemes = await _fetch_all_schemes()

    # 2. Filter to Direct Growth schemes matching category
    cat_display = None
    if category and _norm(category) != "all":
        # Match UI display name from normalized input
        cat_display = next(
            (k for k in CATEGORY_KEYWORDS if _norm(k) == _norm(category)),
            category  # fallback to raw value
        )

    candidates = _filter_schemes_by_name(all_schemes, cat_display, limit=FETCH_LIMIT)

    if not candidates:
        logger.warning(f"No candidates found for category='{category}', falling back to all")
        candidates = _filter_schemes_by_name(all_schemes, None, limit=FETCH_LIMIT)

    logger.info(f"Fetching NAV data for {len(candidates)} candidate funds (category={category})")

    # 3. Fetch NAV data concurrently with semaphore to avoid rate-limiting
    sem = asyncio.Semaphore(SEMAPHORE_LIMIT)

    async def _enrich(scheme: dict) -> Optional[dict]:
        async with sem:
            try:
                code = str(scheme["schemeCode"])
                raw  = await _fetch_fund(code)
                navs = _parse_navs(raw.get("data", []))

                # Need at least 1 year of data to be useful
                if len(navs) < 250:
                    return None

                returns  = _compute_returns(navs)
                meta     = raw.get("meta", {})
                sc       = meta.get("scheme_category", "")
                detected = _detect_category(sc) if sc else (cat_display or "Other")

                return {
                    "scheme_code":  code,
                    "scheme_name":  meta.get("scheme_name", scheme.get("schemeName", "Unknown")),
                    "fund_house":   meta.get("fund_house", "Unknown"),
                    "scheme_type":  meta.get("scheme_type", ""),
                    "category":     detected,
                    "risk":         CATEGORY_RISK.get(detected, "Moderate"),
                    **returns,
                    "nav_date": navs[-1][0].strftime("%d %b %Y") if navs else None,
                }
            except Exception as e:
                logger.warning(f"Skipping {scheme.get('schemeCode')}: {e}")
                return None

    results = await asyncio.gather(*[_enrich(s) for s in candidates])
    funds   = [r for r in results if r is not None]

    # 4. Sort by 3Y CAGR descending, fallback to 1Y
    funds.sort(key=lambda x: x.get("cagr_3y") or x.get("cagr_1y") or 0, reverse=True)

    # 5. Return top N
    top_funds = funds[:limit]

    return {
        "count":    len(top_funds),
        "category": category or "All",
        "funds":    top_funds,
    }


# ─────────────────────────────────────────────
# Endpoint 2 – Single fund detail
# ─────────────────────────────────────────────
@router.get("/fund/{scheme_code}", summary="Fund details and NAV history")
async def get_fund_detail(scheme_code: str):
    raw     = await _fetch_fund(scheme_code)
    navs    = _parse_navs(raw.get("data", []))
    returns = _compute_returns(navs)
    meta    = raw.get("meta", {})

    cutoff      = datetime.now() - timedelta(days=5 * 365)
    monthly_navs = []
    last_month   = None
    for d, n in reversed(navs):
        if d < cutoff:
            break
        ym = (d.year, d.month)
        if ym != last_month:
            monthly_navs.append({"date": d.strftime("%b %Y"), "nav": round(n, 4)})
            last_month = ym
    monthly_navs.reverse()

    return {
        "scheme_code":         scheme_code,
        "scheme_name":         meta.get("scheme_name", "Unknown"),
        "fund_house":          meta.get("fund_house", "Unknown"),
        "scheme_type":         meta.get("scheme_type", ""),
        "scheme_category":     meta.get("scheme_category", ""),
        **returns,
        "nav_date":            navs[-1][0].strftime("%d %b %Y") if navs else None,
        "nav_history":         monthly_navs,
        "total_nav_records":   len(navs),
    }


# ─────────────────────────────────────────────
# Endpoint 3 – Monte Carlo prediction
# ─────────────────────────────────────────────
@router.post("/predict", summary="Monte Carlo SIP value prediction (P10/P50/P90)")
async def predict_sip(body: PredictRequest):
    if body.monthly_amount < 100:
        raise HTTPException(status_code=400, detail="Monthly SIP must be at least ₹100")
    if not (1 <= body.years <= 30):
        raise HTTPException(status_code=400, detail="Years must be between 1 and 30")
    if not (100 <= body.simulations <= 5000):
        raise HTTPException(status_code=400, detail="Simulations must be between 100 and 5000")

    raw    = await _fetch_fund(body.scheme_code)
    navs   = _parse_navs(raw.get("data", []))
    meta   = raw.get("meta", {})
    result = _monte_carlo_sip(navs, body.monthly_amount, body.years, body.simulations)

    return {
        "scheme_code": body.scheme_code,
        "scheme_name": meta.get("scheme_name", "Unknown"),
        "fund_house":  meta.get("fund_house", "Unknown"),
        **result,
    }


# ─────────────────────────────────────────────
# Endpoint 4 – Available categories
# ─────────────────────────────────────────────
@router.get("/categories", summary="List available fund categories")
async def get_categories():
    return {"categories": sorted(CATEGORY_KEYWORDS.keys())}
