"""
Integration tests for the full stock-quant-analyzer pipeline.
Tests: compute_all_scores → compute_dimension_scores → report generation.
Uses mock market data (no network calls).
"""

import sys
import json
from typing import Any, Optional
from scoring import (
    score_pe, score_cape, score_erp, score_fwd_pe,
    score_bofa_bb, score_ig_oas, score_hy_oas,
    score_ma_deviation, score_vix, score_rsi, score_breadth, score_put_call,
    score_core_pce, score_fed_path, score_yield_curve, score_recession_prob,
    score_oil, score_dxy, score_credit_etf, score_gold, score_tlt,
    score_silver, score_copper, score_brent, score_eurusd, score_usdjpy,
    score_btc, score_eem, score_sox, aaii_score,
    compute_geopolitical_risk, composite_score, risk_level,
)


def build_mock_market_data() -> dict:
    """Build a complete mock market_data dict for testing."""
    return {
        "prices": {
            "sp500": 5500.0,
            "tnx": 4.5,
            "irx": 4.0,
            "oil": 85.0,
            "dxy": 104.0,
            "vix": 15.0,
        },
        "valuation": {
            "pe_trailing": 22.0,
            "pe_forward": 20.0,
        },
        "technical": {
            "rsi_14": 55.0,
            "ma200_deviation": 5.0,
        },
        "macro": {
            "yield_10y": 4.5,
            "yield_short": 4.0,
            "spread_10y_2y": 0.5,
            "wti_oil": 85.0,
            "brent_oil": 88.0,
            "dxy": 104.0,
            "eurusd": 1.15,
            "usdjpy": 155.0,
        },
        "credit_etfs": {
            "hyg": {"price": 80.0, "ret_1m_pct": -0.5, "above_ma50": False},
            "lqd": {"price": 108.0, "ret_1m_pct": -0.3, "above_ma50": False},
            "tlt": {"price": 85.0, "ret_1m_pct": -0.2, "above_ma50": False},
        },
        "risk_proxies": {
            "btc": {"price": 60000.0, "ret_1m_pct": -5.0},
            "eem": {"price": 65.0, "ret_1m_pct": -3.0},
            "sox": {"price": 12000.0, "ret_1m_pct": 2.0},
        },
        "commodities": {
            "gld": 390.0,
            "slv": 29.0,
            "cper": 38.0,
        },
        "sectors": {
            "xlf": {"price": 40.0, "ret_1m_pct": 3.0},
            "xlk": {"price": 200.0, "ret_1m_pct": 5.0},
            "xle": {"price": 90.0, "ret_1m_pct": -1.0},
            "xlu": {"price": 65.0, "ret_1m_pct": -2.0},
        },
        "scraper_data": {
            "cape": {"cape": 35.0, "timestamp": "2026-06-06"},
            "errors": [],
        },
        "errors": [],
    }


def test_full_scoring_pipeline():
    """Test the full compute_all_scores pipeline with mock data."""
    from quant_analyzer import compute_all_scores, compute_dimension_scores

    md = build_mock_market_data()
    sd = md.pop("scraper_data", {})

    scores = compute_all_scores(md, sd, market="us")

    # ── All expected keys present ──
    required = ["pe", "fwd_pe", "erp", "cape", "ma200_deviation", "vix", "rsi",
                 "oil", "dxy", "yield_curve", "hyg_credit", "lqd_credit",
                 "tlt_safety", "gold", "silver", "copper", "brent", "eurusd",
                 "usdjpy", "btc", "eem", "sox", "geopolitical_risk",
                 "sector_rotation"]
    for key in required:
        assert key in scores, f"Missing score key: {key}"

    # ── All scores within bounds ──
    for key, val in scores.items():
        if val.get("score") is not None:
            assert 0 <= val["score"] <= 100, f"{key} score {val['score']} out of bounds"

    return scores  # noqa: used for debugging


def test_dimension_scores():
    """Test dimension aggregation."""
    from quant_analyzer import compute_all_scores, compute_dimension_scores

    md = build_mock_market_data()
    sd = md.pop("scraper_data", {})
    scores = compute_all_scores(md, sd, market="us")
    dims = compute_dimension_scores(scores)

    # ── Expected dimension keys ──
    for dim in ["valuation", "flow", "technical", "macro", "composite", "risk"]:
        assert dim in dims, f"Missing dimension: {dim}"

    # ── Composite is valid ──
    comp = dims["composite"]
    assert isinstance(comp, (int, float)), f"Composite not numeric: {comp}"
    assert 0 <= comp <= 100, f"Composite out of range: {comp}"

    # ── Risk level is valid ──
    risk = dims["risk"]
    assert "level" in risk
    assert "signal" in risk
    assert "equity_pct" in risk

    return dims


def test_report_generation():
    """Test report generation doesn't crash."""
    from quant_analyzer import compute_all_scores, compute_dimension_scores, generate_report, compute_event_context

    md = build_mock_market_data()
    sd = md.pop("scraper_data", {})
    scores = compute_all_scores(md, sd, market="us")
    dims = compute_dimension_scores(scores)
    ctx = compute_event_context()

    report = generate_report("us", md, scores, dims, {}, event_ctx=ctx)
    assert isinstance(report, str), "Report not a string"
    assert len(report) > 500, f"Report too short: {len(report)} chars"

    # Key sections present
    key_sections = ["量化評估報告", "綜合評分卡", "估值面", "資金流/信用面",
                     "技術面", "總經面", "信號集成", "Exa Search", "事件情境感知"]
    for section in key_sections:
        assert section in report, f"Missing section: {section}"

    return report


def test_composite_known_input():
    """Test composite score with known values."""
    c = composite_score(50.0, 50.0, 50.0, 50.0)
    assert c == 50.0, f"Expected 50, got {c}"

    c = composite_score(100.0, 100.0, 100.0, 100.0)
    assert c == 100.0, f"Expected 100, got {c}"

    c = composite_score(0.0, 0.0, 0.0, 0.0)
    assert c == 0.0, f"Expected 0, got {c}"

    c = composite_score(80.0, 60.0, 70.0, 90.0)
    # 80*0.3 + 60*0.25 + 70*0.2 + 90*0.25 = 24+15+14+22.5 = 75.5
    assert abs(c - 75.5) < 0.01, f"Expected 75.5, got {c}"


def test_risk_level_mapping():
    """Test risk level mapping covers all ranges."""
    for score, expected in [(95, "極度安全"), (75, "安全"), (55, "中性"),
                             (40, "謹慎"), (25, "風險偏高"), (10, "極度危險")]:
        r = risk_level(score)
        assert expected in r["level"], f"Score {score}: expected {expected}, got {r['level']}"
        assert "equity_pct" in r
        assert "signal" in r


def test_event_context_structure():
    """Test event context generates valid structure."""
    from quant_analyzer import compute_event_context
    ctx = compute_event_context()
    expected_keys = ["date", "week_of_month", "quarter", "quarter_month",
                     "earnings_phase", "is_fomc_month", "notes", "search_prompts"]
    for key in expected_keys:
        assert key in ctx, f"Missing event context key: {key}"
    assert isinstance(ctx["notes"], list)
    assert isinstance(ctx["search_prompts"], list)


def test_circuit_breaker_import():
    """Test circuit breaker module imports and functions exist."""
    from scrapers import _circuit_open, _record_failure, _record_success, _load_circuit, _save_circuit
    assert callable(_circuit_open)
    assert callable(_record_failure)
    assert callable(_record_success)


def test_geo_political_risk():
    """Test geopolitical risk computation."""
    md = build_mock_market_data()
    result = compute_geopolitical_risk(md)
    assert "score" in result
    assert "signals" in result
    assert 0 <= result["score"] <= 100
    assert isinstance(result["signals"], list)


def test_put_call_no_hang():
    """Test that put/call fetcher doesn't hang (times out fast)."""
    from scrapers import fetch_put_call_ratio
    import time
    start = time.time()
    result = fetch_put_call_ratio()
    elapsed = time.time() - start
    # Should either return data or None quickly
    assert elapsed < 30, f"Put/call fetch took too long: {elapsed:.1f}s"
    assert result is None or isinstance(result, dict)
