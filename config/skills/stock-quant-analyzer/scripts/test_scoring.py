#!/usr/bin/env python3
"""
Unit tests for scoring.py — pure function tests, no I/O.
Run: python3 -m pytest test_scoring.py -v
Or:   python3 test_scoring.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from scoring import (
    score_pe, score_cape, score_erp, score_fwd_pe,
    score_bofa_bb, score_ig_oas, score_hy_oas,
    score_ma_deviation, score_vix, score_rsi, score_breadth, score_put_call,
    score_core_pce, score_fed_path, score_yield_curve, score_recession_prob, score_oil,
    score_dxy, score_mkt_gdp,
    score_tw_price_pct, score_tw_volume_ratio,
    aaii_score,
    composite_score, risk_level,
)


def test_score_pe_cheap():
    assert score_pe(12) > 80  # Below mean = cheap

def test_score_pe_expensive():
    assert score_pe(35) < 20  # 2x mean = expensive

def test_score_pe_mean():
    s = score_pe(17.6)
    assert 70 <= s <= 85  # At mean should be moderate-high

def test_score_pe_none():
    assert score_pe(None) == 0

def test_score_pe_negative():
    assert score_pe(-5) == 0


def test_score_cape_extreme():
    assert score_cape(40) < 10  # >2x mean

def test_score_cape_cheap():
    assert score_cape(12) > 80  # <0.8x mean

def test_score_cape_none():
    assert score_cape(None) == 0


def test_score_erp_positive():
    assert score_erp(10, 4.5) > 80  # P/E=10, EY=10%, ERP=5.5% = very good

def test_score_erp_negative():
    assert score_erp(25, 5.0) < 30  # ERP ~ -1%

def test_score_erp_none():
    assert score_erp(None, 4.5) is None
    assert score_erp(25, None) is None


def test_score_fwd_pe():
    assert score_fwd_pe(15) > 80
    assert score_fwd_pe(35) < 20
    assert score_fwd_pe(None) == 0


def test_score_bofa_bb():
    assert score_bofa_bb(1.0) > 85  # Extreme bearish = buy
    assert score_bofa_bb(9.0) < 20  # Extreme bullish = sell
    assert score_bofa_bb(None) == 0


def test_score_ig_oas():
    assert score_ig_oas(1.0) == 70  # Healthy
    assert score_ig_oas(0.5) == 50  # Too tight
    assert score_ig_oas(3.0) < 20   # Stress
    assert score_ig_oas(None) == 0


def test_score_hy_oas():
    assert score_hy_oas(3.5) == 70  # Healthy
    assert score_hy_oas(2.0) == 50  # Too tight
    assert score_hy_oas(7.0) < 20   # Stress
    assert score_hy_oas(None) == 0


def test_score_ma_deviation():
    assert score_ma_deviation(2) > 70   # Close to MA
    assert score_ma_deviation(25) < 20  # Far above MA
    assert score_ma_deviation(None) == 0


def test_score_vix():
    assert score_vix(12) == 40   # Complacency
    assert 60 <= score_vix(22) <= 70  # Moderate (20-25 range)
    assert score_vix(35) == 40   # Panic
    assert score_vix(None) == 0


def test_score_rsi():
    assert score_rsi(40) > 80    # Oversold = buy
    assert score_rsi(85) < 20    # Overbought = sell
    assert score_rsi(55) == 60   # Neutral
    assert score_rsi(None) == 0


def test_score_breadth():
    assert score_breadth(80) > 80
    assert score_breadth(20) < 30
    assert score_breadth(None) == 0


def test_score_put_call():
    assert score_put_call(1.5) > 80  # High PCR = fear = buy
    assert score_put_call(0.5) < 30  # Low PCR = complacency
    assert score_put_call(None) == 0


def test_score_core_pce():
    assert score_core_pce(1.5) > 90
    assert score_core_pce(4.0) < 20
    assert score_core_pce(None) == 0


def test_score_fed_path():
    assert score_fed_path(5) > 80    # Low hike prob
    assert score_fed_path(60) < 20   # High hike prob
    assert score_fed_path(None) == 0


def test_score_yield_curve():
    assert score_yield_curve(1.5) > 80   # Steep = healthy
    assert score_yield_curve(-0.5) < 30  # Inverted = danger
    assert score_yield_curve(None) == 0


def test_score_recession_prob():
    assert score_recession_prob(5) > 80
    assert score_recession_prob(60) < 20
    assert score_recession_prob(None) == 0
    assert score_recession_prob(0) > 80


def test_score_mkt_gdp():
    assert score_mkt_gdp(60) > 80
    assert score_mkt_gdp(180) < 30
    assert score_mkt_gdp(None) == 0


def test_score_tw_price_pct():
    assert score_tw_price_pct(5) > 80   # near low = cheap
    assert score_tw_price_pct(95) < 20  # near high = expensive
    assert score_tw_price_pct(49) == 55  # below midpoint = fair
    assert score_tw_price_pct(None) == 0


def test_score_tw_volume_ratio():
    assert score_tw_volume_ratio(0.3) < 60  # very low = neutral
    assert score_tw_volume_ratio(1.0) >= 55  # normal = healthy
    assert score_tw_volume_ratio(2.0) < 40  # very high = bearish
    assert score_tw_volume_ratio(None) == 0


def test_score_bounds():
    """All scores should be in [0, 100]."""
    funcs = [
        (score_pe, [10, 17.6, 25, 35, 50]),
        (score_cape, [10, 17.7, 25, 40, 60]),
        (score_fwd_pe, [10, 23, 30, 40]),
        (score_bofa_bb, [0.5, 3, 5, 7, 9]),
        (score_ig_oas, [0.5, 1.0, 1.5, 2.5, 4.0]),
        (score_hy_oas, [2.0, 3.5, 5.0, 7.0, 10.0]),
        (score_ma_deviation, [0, 5, 10, 20, 30]),
        (score_vix, [10, 15, 20, 25, 35, 50]),
        (score_rsi, [20, 40, 55, 70, 85]),
        (score_breadth, [10, 40, 60, 80]),
        (score_put_call, [0.3, 0.7, 1.0, 1.5]),
        (score_core_pce, [1.0, 2.0, 3.0, 4.5]),
        (score_fed_path, [5, 20, 40, 60]),
        (score_yield_curve, [-1.0, 0, 0.5, 1.5]),
        (score_recession_prob, [5, 20, 40, 60]),
        (score_oil, [50, 75, 95, 130]),
        (score_dxy, [85, 95, 105, 115]),
        (score_mkt_gdp, [60, 100, 130, 180, 220]),
        (score_tw_price_pct, [5, 20, 49, 60, 95]),
        (score_tw_volume_ratio, [0.3, 0.8, 1.0, 1.5, 2.5]),
    ]
    for func, values in funcs:
        for v in values:
            s = func(v)
            assert 0 <= s <= 100, f"{func.__name__}({v}) = {s} (out of bounds)"


if __name__ == "__main__":
    # Simple test runner (no pytest needed)
    import traceback
    tests = [obj for name, obj in globals().items() if name.startswith("test_")]
    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
            print(f"  ✅ {test.__name__}")
        except Exception as e:
            failed += 1
            print(f"  ❌ {test.__name__}: {e}")
    print(f"\n{'='*50}")
    print(f"  Results: {passed} passed, {failed} failed, {len(tests)} total")
    if failed:
        sys.exit(1)