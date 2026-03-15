"""
main_app.py — Financial Intelligence Pipeline
==============================================
Usage:
    python main_app.py <file1> [file2] [file3] ...

Features:
    - Multi-file batch processing (PDFs, images)
    - Gemini Vision extraction  →  Gemini Brain analysis
    - Interactive Plotly dashboard (browser)
    - Full JSON export to ./reports/
    - Text summary report export
"""

import sys
import os
import json
import logging
import datetime
from pathlib import Path
from typing import List, Optional

import plotly.graph_objects as go
from plotly.subplots import make_subplots

from vision_extractor import extract_financial_data, VisionExtractionError
from brain_reasoner import reason_about_spending, ReasoningError

# Suppress noisy HTTP logs from underlying libraries
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

REPORTS_DIR = Path("./reports")


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

def generate_dashboard(coach_advice: dict, output_path: Optional[Path] = None) -> None:
    """
    FIX #13: Safely handle None/empty sip_suggestions.
    NEW: 3-panel dashboard — bar chart, category pie chart, summary card.
    NEW: Optional HTML export so it works in headless environments too.
    """
    suggestions = coach_advice.get("sip_suggestions") or []  # FIX #13: guard None

    if not suggestions:
        print("ℹ️  No discretionary spending found — nothing to graph.")
        return

    items = [s["item"][:22] + "…" if len(s["item"]) > 22 else s["item"] for s in suggestions]
    spent = [s["cost"] for s in suggestions]
    potential = [s["sip_10yr_potential"] for s in suggestions]
    opportunity = [s["opportunity_cost"] for s in suggestions]

    # Category breakdown
    category_totals: dict = {}
    for s in suggestions:
        cat = s.get("category", "Unknown")
        category_totals[cat] = category_totals.get(cat, 0) + s["cost"]

    fig = make_subplots(
        rows=2, cols=2,
        subplot_titles=(
            "💸 Spend vs 10-Year SIP Potential",
            "🗂️ Spending by Category",
            "📉 Opportunity Cost per Item",
            "📋 Financial Health Summary",
        ),
        specs=[
            [{"type": "bar"}, {"type": "pie"}],
            [{"type": "bar"}, {"type": "table"}],
        ],
        vertical_spacing=0.15,
        horizontal_spacing=0.1,
    )

    # Panel 1: Grouped bar — spent vs potential
    fig.add_trace(
        go.Bar(name="Spent Today (₹)", x=items, y=spent, marker_color="#ef4444", text=[f"₹{v:,.0f}" for v in spent], textposition="outside"),
        row=1, col=1
    )
    fig.add_trace(
        go.Bar(name="10-Year SIP Value (₹)", x=items, y=potential, marker_color="#10b981", text=[f"₹{v:,.0f}" for v in potential], textposition="outside"),
        row=1, col=1
    )

    # Panel 2: Pie — category breakdown
    fig.add_trace(
        go.Pie(
            labels=list(category_totals.keys()),
            values=list(category_totals.values()),
            hole=0.4,
            textinfo="label+percent",
        ),
        row=1, col=2
    )

    # Panel 3: Opportunity cost bar
    fig.add_trace(
        go.Bar(
            name="Wealth Lost (₹)",
            x=items,
            y=opportunity,
            marker_color="#f59e0b",
            text=[f"₹{v:,.0f}" for v in opportunity],
            textposition="outside",
            showlegend=False,
        ),
        row=2, col=1
    )

    # Panel 4: Summary table
    insights = coach_advice.get("insights", [])
    table_rows = [
        ["Total Discretionary Spend", f"₹{coach_advice.get('total_discretionary_spend', 0):,.2f}"],
        ["10-Year Opportunity Cost", f"₹{coach_advice.get('total_potential_savings', 0):,.2f}"],
        ["Items Flagged", str(len(suggestions))],
    ] + [[f"Insight {i+1}", ins] for i, ins in enumerate(insights[:3])]

    fig.add_trace(
        go.Table(
            header=dict(values=["Metric", "Value"], fill_color="#1e293b", font=dict(color="white")),
            cells=dict(
                values=[[r[0] for r in table_rows], [r[1] for r in table_rows]],
                fill_color=[["#0f172a"] * len(table_rows), ["#1e293b"] * len(table_rows)],
                font=dict(color="white"),
                align=["left", "right"],
            ),
        ),
        row=2, col=2
    )

    fig.update_layout(
        title="🎯 Financial Intelligence Dashboard — SIP Opportunity Cost Analysis",
        template="plotly_dark",
        barmode="group",
        height=900,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )

    # FIX #16: save to HTML first (always works), then try browser
    if output_path:
        html_path = output_path.with_suffix(".html")
        fig.write_html(str(html_path))
        print(f"📊 Dashboard saved → {html_path}")

    try:
        fig.show(renderer="browser")
        print("📊 Dashboard opened in browser.")
    except Exception as e:
        logger.warning(f"Could not open browser renderer: {e}. Dashboard saved to HTML above.")


# ---------------------------------------------------------------------------
# Report export
# ---------------------------------------------------------------------------

def export_reports(
    combined_data: dict,
    coach_advice: dict,
    output_dir: Path,
    timestamp: str,
) -> None:
    """FIX #14: Save full JSON and human-readable text report to disk."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # Raw extraction JSON
    json_path = output_dir / f"extraction_{timestamp}.json"
    json_path.write_text(json.dumps(combined_data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"💾 Extraction data saved → {json_path}")

    # Coaching advice JSON
    advice_path = output_dir / f"coaching_{timestamp}.json"
    advice_path.write_text(json.dumps(coach_advice, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"💾 Coaching report saved → {advice_path}")

    # Human-readable text summary
    txt_path = output_dir / f"summary_{timestamp}.txt"
    lines = [
        "=" * 60,
        "  FINANCIAL INTELLIGENCE REPORT",
        f"  Generated: {timestamp}",
        "=" * 60,
        "",
        "SUMMARY",
        "-------",
        coach_advice.get("summary", "N/A"),
        "",
        "INSIGHTS",
        "--------",
    ]
    for i, ins in enumerate(coach_advice.get("insights", []), 1):
        lines.append(f"  {i}. {ins}")
    lines += [
        "",
        "DISCRETIONARY ITEMS (SIP CANDIDATES)",
        "-------------------------------------",
    ]
    for sip in coach_advice.get("sip_suggestions", []):
        lines.append(f"  • {sip['item']}")
        lines.append(f"    Cost: ₹{sip['cost']:,.2f}  |  10-yr SIP Value: ₹{sip['sip_10yr_potential']:,.2f}  |  Opportunity Cost: ₹{sip['opportunity_cost']:,.2f}")
        lines.append(f"    {sip['reasoning']}")
        lines.append("")
    lines += [
        "-" * 60,
        f"  Total Discretionary Spend : ₹{coach_advice.get('total_discretionary_spend', 0):,.2f}",
        f"  Total 10-yr Opportunity Cost: ₹{coach_advice.get('total_potential_savings', 0):,.2f}",
        "=" * 60,
    ]
    txt_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"📄 Text summary saved  → {txt_path}")


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_financial_advisor(file_paths: List[str]) -> None:
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    master_records = []
    failed_files = []

    # ── Step 1: Vision extraction ──────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  [1/3] 👀 Scanning {len(file_paths)} file(s) with Gemini Vision")
    print(f"{'='*60}")

    for i, file_path in enumerate(file_paths, 1):
        print(f"\n  [{i}/{len(file_paths)}] Processing: {file_path}")
        try:
            extracted = extract_financial_data(file_path, "Financial Document")
            records = extracted.get("extracted_records", [])
            tx_count = sum(len(r.get("transactions", [])) for r in records)
            print(f"  ✅ Found {tx_count} transaction(s) in {len(records)} record(s).")
            master_records.extend(records)
        except VisionExtractionError as e:
            logger.error(f"  ❌ Failed to process '{file_path}': {e}")
            failed_files.append(file_path)

    if failed_files:
        print(f"\n⚠️  {len(failed_files)} file(s) could not be processed: {failed_files}")

    if not master_records:
        print("❌ No transactions found across any files. Aborting.")
        return

    combined_data = {"extracted_records": master_records}
    total_tx = sum(len(r.get("transactions", [])) for r in master_records)
    print(f"\n✅ Aggregated {total_tx} total transaction(s) from {len(master_records)} record(s).")

    # ── Step 2: Brain reasoning ────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("  [2/3] 🧠 Analysing with Financial Brain...")
    print(f"{'='*60}\n")

    try:
        coach_advice = reason_about_spending(combined_data)
    except ReasoningError as e:
        print(f"❌ Brain reasoning failed: {e}")
        return

    # ── Print coaching report ──────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("       🎯 MASTER FINANCIAL COACHING REPORT 🎯")
    print("=" * 60)
    print(f"\n📝 Summary:\n   {coach_advice.get('summary', 'N/A')}\n")

    insights = coach_advice.get("insights", [])
    if insights:
        print("💡 Key Insights:")
        for ins in insights:
            print(f"   • {ins}")
        print()

    print("🛒 Discretionary Spending (SIP Candidates):")
    for sip in coach_advice.get("sip_suggestions", []):
        print(f"\n  ➡️  {sip['item']}")
        print(f"     💰 Spent: ₹{sip['cost']:,.2f}")
        print(f"     📈 10-yr SIP Value: ₹{sip['sip_10yr_potential']:,.2f}")
        print(f"     📉 Opportunity Cost: ₹{sip['opportunity_cost']:,.2f}")
        print(f"     🗣️  {sip['reasoning']}")

    print("\n" + "-" * 60)
    print(f"  💸 Total Discretionary Spend    : ₹{coach_advice.get('total_discretionary_spend', 0):,.2f}")
    print(f"  🚨 Total 10-yr Opportunity Cost : ₹{coach_advice.get('total_potential_savings', 0):,.2f}")
    print("=" * 60 + "\n")

    # ── Step 3: Export reports ────────────────────────────────────────────
    print(f"[3/3] 💾 Exporting reports...")
    dashboard_html_path = REPORTS_DIR / f"dashboard_{timestamp}"
    export_reports(combined_data, coach_advice, REPORTS_DIR, timestamp)

    # ── Step 4: Dashboard ─────────────────────────────────────────────────
    print("\n📈 Generating dashboard...")
    generate_dashboard(coach_advice, output_path=dashboard_html_path)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    input_files = sys.argv[1:]

    if not input_files:
        print("Usage: python main_app.py <file1> [file2] [file3] ...")
        print("Example: python main_app.py amazon.pdf upi_lunch.jpg bank_statement.pdf")
        sys.exit(1)

    # Validate files exist before starting
    missing = [f for f in input_files if not os.path.exists(f)]
    if missing:
        print(f"❌ The following files were not found: {missing}")
        sys.exit(1)

    run_financial_advisor(input_files)