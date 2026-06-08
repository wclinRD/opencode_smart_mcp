"""
Scoring rules for the 20-indicator quantitative model.
Pure functions — no I/O, no side effects.
All scores are 0-100 (100 = safest/cheapest, 0 = most dangerous/expensive).
"""

from typing import Optional


# ═══════════════════════════════════════════════════════════════
# Valuation (Weight: 30%)
# ═══════════════════════════════════════════════════════════════

def score_pe(pe: float, benchmark: float = 17.6) -> int:
    """S&P 500 P/E scoring. Benchmark = historical mean."""
    if pe is None or pe <= 0:
        return 0
    ratio = pe / benchmark
    if ratio < 1.0:
        return min(100, int(80 + (1.0 - ratio) * 40))
    elif ratio < 1.3:
        return int(80 - (ratio - 1.0) / 0.3 * 20)
    elif ratio < 1.6:
        return int(60 - (ratio - 1.3) / 0.3 * 20)
    elif ratio < 1.9:
        return int(40 - (ratio - 1.6) / 0.3 * 20)
    else:
        return max(0, int(20 - (ratio - 1.9) * 10))


def score_cape(cape: float, benchmark: float = 17.7) -> int:
    """Shiller CAPE scoring."""
    if cape is None or cape <= 0:
        return 0
    ratio = cape / benchmark
    if ratio < 0.8:
        return min(100, int(90 + (0.8 - ratio) * 50))
    elif ratio < 1.0:
        return int(90 - (ratio - 0.8) / 0.2 * 20)
    elif ratio < 1.3:
        return int(70 - (ratio - 1.0) / 0.3 * 20)
    elif ratio < 1.6:
        return int(50 - (ratio - 1.3) / 0.3 * 20)
    elif ratio < 2.0:
        return int(30 - (ratio - 1.6) / 0.4 * 20)
    else:
        return max(0, int(10 - (ratio - 2.0) * 5))


def score_erp(pe: float, yield_10y: float) -> Optional[int]:
    """Equity Risk Premium = Earnings Yield - 10Y Treasury."""
    if pe is None or pe <= 0 or yield_10y is None:
        return None
    ey = (1.0 / pe) * 100
    erp = ey - yield_10y
    if erp > 3.0:
        return min(100, int(90 + (erp - 3.0) * 5))
    elif erp > 2.0:
        return int(70 + (erp - 2.0) * 20)
    elif erp > 1.0:
        return int(50 + (erp - 1.0) * 20)
    elif erp > 0.0:
        return int(30 + erp * 20)
    else:
        return max(0, int(20 + erp * 10))


def score_fwd_pe(fwd_pe: float, benchmark: float = 23.0) -> int:
    """Forward P/E scoring. 10Y mean ~23 for S&P 500."""
    if fwd_pe is None or fwd_pe <= 0:
        return 0
    ratio = fwd_pe / benchmark
    if ratio < 0.8:
        return min(100, int(80 + (0.8 - ratio) * 50))
    elif ratio < 1.0:
        return int(80 - (ratio - 0.8) / 0.2 * 20)
    elif ratio < 1.2:
        return int(60 - (ratio - 1.0) / 0.2 * 20)
    elif ratio < 1.5:
        return int(40 - (ratio - 1.2) / 0.3 * 20)
    else:
        return max(0, int(20 - (ratio - 1.5) * 10))


def score_mkt_gdp(ratio: float) -> int:
    """
    Market Cap / GDP (Buffett Indicator) scoring.
    Historical average ~100-120%.  Above 150% = extreme overvalued.
    """
    if ratio is None or ratio <= 0:
        return 0
    if ratio < 80:
        return 95  # severely undervalued
    elif ratio < 100:
        return 75  # undervalued
    elif ratio < 120:
        return 55  # fair
    elif ratio < 150:
        return 35  # overvalued
    elif ratio < 180:
        return 20  # significantly overvalued
    else:
        return max(0, int(15 - (ratio - 180) / 20 * 5))  # extreme


# ═══════════════════════════════════════════════════════════════
# Fund Flow / Credit (Weight: 25%)
# ═══════════════════════════════════════════════════════════════

def score_bofa_bb(value: float) -> int:
    """BofA Bull & Bear indicator. <2 = extreme bearish (buy), >8 = sell."""
    if value is None:
        return 0
    if value < 2:
        return min(100, int(90 + (2 - value) * 10))
    elif value < 4:
        return int(70 + (4 - value) / 2 * 20)
    elif value < 6:
        return int(50 + (6 - value) / 2 * 20)
    elif value < 8:
        return int(30 + (8 - value) / 2 * 20)
    else:
        return max(0, int(20 - (value - 8) * 5))


def score_ig_oas(oas: float) -> int:
    """IG credit spread (OAS) scoring. Inverted-U shape."""
    if oas is None:
        return 0
    if oas < 0.8:
        return 50  # too tight = complacency
    elif oas < 1.2:
        return 70  # healthy
    elif oas < 1.5:
        return 50  # widening
    elif oas < 2.0:
        return 30  # stress
    else:
        return max(0, int(20 - (oas - 2.0) * 10))


def score_hy_oas(oas: float) -> int:
    """HY credit spread (OAS) scoring. Inverted-U shape."""
    if oas is None:
        return 0
    if oas < 3.0:
        return 50
    elif oas < 4.0:
        return 70
    elif oas < 5.0:
        return 50
    elif oas < 6.0:
        return 30
    else:
        return max(0, int(20 - (oas - 6.0) * 5))


def score_equity_flow(direction: str) -> int:
    """Equity fund flow direction → score."""
    if not direction:
        return 0
    d = direction.lower()
    if "strong_inflow" in d or "heavy_inflow" in d:
        return 75
    elif "inflow" in d:
        return 65
    elif "neutral" in d or "flat" in d:
        return 50
    elif "outflow" in d:
        return 30
    elif "heavy_outflow" in d:
        return 15
    return 50


def score_hf_exposure(level: str) -> int:
    """Hedge fund exposure level → score (contrarian)."""
    if not level:
        return 0
    l = level.lower()
    if "very_low" in l or "underweight" in l:
        return 85  # contrarian buy
    elif "low" in l:
        return 70
    elif "neutral" in l:
        return 50
    elif "high" in l:
        return 35
    elif "very_high" in l or "overweight" in l:
        return 15  # contrarian sell
    return 50


# ═══════════════════════════════════════════════════════════════
# Technical (Weight: 20%)
# ═══════════════════════════════════════════════════════════════

def score_ma_deviation(deviation_pct: float) -> int:
    """200MA deviation scoring."""
    if deviation_pct is None:
        return 0
    if deviation_pct < 5:
        return min(100, int(70 + (5 - deviation_pct) * 6))
    elif deviation_pct < 10:
        return int(50 + (10 - deviation_pct) / 5 * 20)
    elif deviation_pct < 15:
        return int(30 + (15 - deviation_pct) / 5 * 20)
    elif deviation_pct < 20:
        return int(20 + (20 - deviation_pct) / 5 * 10)
    else:
        return max(0, int(20 - (deviation_pct - 20) * 2))


def score_vix(vix: float) -> int:
    """VIX scoring."""
    if vix is None:
        return 0
    if vix < 15:
        return 40
    elif vix < 20:
        return int(40 + (vix - 15) / 5 * 20)
    elif vix < 25:
        return int(60 + (vix - 20) / 5 * 10)
    elif vix < 30:
        return int(70 - (vix - 25) / 5 * 20)
    else:
        return max(20, int(50 - (vix - 30) * 2))


def score_rsi(rsi: float) -> int:
    """RSI(14) scoring."""
    if rsi is None:
        return 0
    if 30 <= rsi <= 50:
        return min(100, int(80 + (50 - rsi) / 20 * 20))
    elif 50 < rsi <= 60:
        return int(70 - (rsi - 50) / 10 * 20)
    elif 60 < rsi <= 70:
        return int(50 - (rsi - 60) / 10 * 20)
    elif 70 < rsi <= 80:
        return int(30 - (rsi - 70) / 10 * 10)
    elif rsi > 80:
        return max(0, int(20 - (rsi - 80) * 2))
    else:  # rsi < 30
        return min(100, int(80 + (30 - rsi) * 2))


def score_breadth(pct_above_200ma: float) -> int:
    """Market breadth scoring."""
    if pct_above_200ma is None:
        return 0
    if pct_above_200ma > 70:
        return min(100, int(80 + (pct_above_200ma - 70) / 30 * 20))
    elif pct_above_200ma > 50:
        return int(60 + (pct_above_200ma - 50) / 20 * 20)
    elif pct_above_200ma > 30:
        return int(40 + (pct_above_200ma - 30) / 20 * 20)
    else:
        return max(0, int(pct_above_200ma / 30 * 40))


def score_put_call(pcr: float) -> int:
    """Put/Call Ratio scoring (contrarian)."""
    if pcr is None:
        return 0
    if pcr > 1.2:
        return min(100, int(80 + (pcr - 1.2) * 50))
    elif pcr > 1.0:
        return int(70 + (pcr - 1.0) / 0.2 * 10)
    elif pcr > 0.8:
        return int(50 + (pcr - 0.8) / 0.2 * 20)
    elif pcr > 0.6:
        return int(30 + (pcr - 0.6) / 0.2 * 20)
    else:
        return max(0, int(pcr / 0.6 * 30))


# ═══════════════════════════════════════════════════════════════
# Macro (Weight: 25%)
# ═══════════════════════════════════════════════════════════════

def score_core_pce(pce: float) -> int:
    """Core PCE inflation scoring."""
    if pce is None:
        return 0
    if pce < 2.0:
        return min(100, int(90 + (2.0 - pce) * 20))
    elif pce < 2.5:
        return int(70 + (2.5 - pce) / 0.5 * 20)
    elif pce < 3.0:
        return int(50 + (3.0 - pce) / 0.5 * 20)
    elif pce < 3.5:
        return int(30 + (3.5 - pce) / 0.5 * 20)
    else:
        return max(0, int(20 - (pce - 3.5) * 10))


def score_fed_path(hike_prob: float) -> int:
    """Fed rate hike probability scoring."""
    if hike_prob is None:
        return 0
    if hike_prob < 10:
        return min(100, int(80 + (10 - hike_prob) * 2))
    elif hike_prob < 20:
        return int(60 + (20 - hike_prob) / 10 * 20)
    elif hike_prob < 30:
        return int(40 + (30 - hike_prob) / 10 * 20)
    elif hike_prob < 50:
        return int(20 + (50 - hike_prob) / 20 * 20)
    else:
        return max(0, int(20 - (hike_prob - 50) * 1))


def score_yield_curve(spread: float) -> int:
    """10Y-2Y spread scoring."""
    if spread is None:
        return 0
    if spread > 1.0:
        return min(100, int(80 + (spread - 1.0) * 20))
    elif spread > 0.5:
        return int(70 + (spread - 0.5) / 0.5 * 10)
    elif spread > 0:
        return int(50 + spread / 0.5 * 20)
    else:
        return max(0, int(30 + spread * 10))


def score_recession_prob(prob: float) -> int:
    """Recession probability scoring."""
    if prob is None:
        return 0
    if prob < 15:
        return min(100, int(80 + (15 - prob) * 2))
    elif prob < 25:
        return int(60 + (25 - prob) / 10 * 20)
    elif prob < 35:
        return int(40 + (35 - prob) / 10 * 20)
    elif prob < 50:
        return int(20 + (50 - prob) / 15 * 20)
    else:
        return max(0, int(20 - (prob - 50) * 1))


def score_oil(wti: float) -> int:
    """WTI oil price scoring."""
    if wti is None:
        return 0
    if wti < 70:
        return min(100, int(80 + (70 - wti) * 2))
    elif wti < 85:
        return int(60 + (85 - wti) / 15 * 20)
    elif wti < 100:
        return int(40 + (100 - wti) / 15 * 20)
    elif wti < 120:
        return int(20 + (120 - wti) / 20 * 20)
    else:
        return max(0, int(20 - (wti - 120) * 1))


def score_dxy(dxy: float) -> int:
    """DXY (US Dollar Index) scoring. Strong dollar = headwind for equities."""
    if dxy is None:
        return 0
    if dxy < 95:
        return min(100, int(80 + (95 - dxy) * 2))
    elif dxy < 100:
        return int(60 + (100 - dxy) / 5 * 20)
    elif dxy < 105:
        return int(40 + (105 - dxy) / 5 * 20)
    elif dxy < 110:
        return int(20 + (110 - dxy) / 5 * 20)
    else:
        return max(0, int(20 - (dxy - 110) * 1))


# ═══════════════════════════════════════════════════════════════
# Credit ETF Proxies (free alternatives to OAS)
# ═══════════════════════════════════════════════════════════════

def score_credit_etf(etf_data: dict) -> Optional[int]:
    """
    Score a credit ETF (HYG/LQD) as proxy for credit health.
    Above 50MA = healthy credit = higher score.
    Below 200MA = credit stress = lower score.
    """
    if not etf_data:
        return None
    price = etf_data.get("price")
    ma50 = etf_data.get("ma50")
    ma200 = etf_data.get("ma200")
    ret_1m = etf_data.get("ret_1m_pct")

    if not price or not ma50:
        return None

    score = 50  # base

    # Above/below MA50
    if price > ma50:
        score += 15
    else:
        score -= 15

    # Above/below MA200 (stronger signal)
    if ma200 and price > ma200:
        score += 10
    elif ma200:
        score -= 20

    # 1-month momentum
    if ret_1m is not None:
        if ret_1m > 2:
            score += 10
        elif ret_1m > 0:
            score += 5
        elif ret_1m > -2:
            score -= 5
        else:
            score -= 15

    return max(0, min(100, score))


def score_gold(gold_price: float, gold_ma50: Optional[float] = None) -> int:
    """
    Gold scoring. Rising gold = fear/hedging = bearish for equities (contrarian).
    Above MA50 and rising = more fear = lower score.
    """
    if gold_price is None:
        return 0
    # Base: gold below $2000 is neutral, above $2500 is fear
    if gold_price < 2000:
        base = 70
    elif gold_price < 2200:
        base = 60
    elif gold_price < 2500:
        base = 45
    elif gold_price < 2800:
        base = 30
    else:
        base = 15

    # MA50 adjustment
    if gold_ma50:
        if gold_price > gold_ma50:
            base -= 10  # rising gold = more fear
        else:
            base += 5   # falling gold = less fear

    return max(0, min(100, base))


def score_tlt(tlt_data: dict) -> Optional[int]:
    """
    TLT (20Y Treasury ETF) scoring.
    Rising TLT = flight to safety = bearish for equities.
    Falling TLT = risk-on = bullish.
    """
    if not tlt_data:
        return None
    price = tlt_data.get("price")
    ma50 = tlt_data.get("ma50")
    ret_1m = tlt_data.get("ret_1m_pct")

    if not price:
        return None

    score = 50
    if ma50:
        if price > ma50:
            score -= 15  # bonds rallying = risk-off
        else:
            score += 10  # bonds selling off = risk-on

    if ret_1m is not None:
        if ret_1m > 3:
            score -= 15  # strong bond rally = fear
        elif ret_1m > 0:
            score -= 5
        elif ret_1m > -3:
            score += 5
        else:
            score += 10  # bond selloff = risk appetite

    return max(0, min(100, score))


# ═══════════════════════════════════════════════════════════════
# TW Market Indicators
# ═══════════════════════════════════════════════════════════════

def score_tw_price_pct(pct: float) -> int:
    """
    Score TWII price position within 52-week range.
    Near low = cheap/bullish (high score). Near high = expensive/bearish.
    """
    if pct is None:
        return 0
    if pct < 10:
        return 90  # near yearly low = very cheap
    elif pct < 25:
        return 70  # lower quartile = cheap
    elif pct < 50:
        return 55  # below midpoint = fair-cheap
    elif pct < 75:
        return 40  # above midpoint = fair-expensive
    elif pct < 90:
        return 25  # upper quartile = expensive
    else:
        return 10  # near yearly high = very expensive


def score_tw_volume_ratio(ratio: float) -> int:
    """
    Score TWII volume vs 20-day average.
    Very low = lethargy (neutral). Very high = climax (bearish).
    """
    if ratio is None:
        return 0
    if ratio < 0.4:
        return 45  # extremely low volume = disinterest
    elif ratio < 0.7:
        return 55  # below avg = quiet
    elif ratio < 1.3:
        return 60  # normal range = healthy
    elif ratio < 1.8:
        return 40  # elevated = potential distribution
    elif ratio < 2.5:
        return 25  # high = climax
    else:
        return 15  # extreme = blow-off


# ═══════════════════════════════════════════════════════════════
# Commodities & FX
# ═══════════════════════════════════════════════════════════════

def score_copper(copper: float) -> int:
    """Copper ("Dr. Copper") scoring. Rising = economic expansion = bullish."""
    if copper is None:
        return 0
    if copper > 5.0:
        return min(100, int(80 + (copper - 5.0) * 20))
    elif copper > 4.5:
        return int(60 + (copper - 4.5) / 0.5 * 20)
    elif copper > 4.0:
        return int(40 + (copper - 4.0) / 0.5 * 20)
    elif copper > 3.5:
        return int(20 + (copper - 3.5) / 0.5 * 20)
    else:
        return max(0, int(copper / 3.5 * 20))


def score_silver(silver: float) -> int:
    """Silver scoring. Hybrid industrial + precious. High = inflation fear."""
    if silver is None:
        return 0
    if silver < 25:
        return min(100, int(70 + (25 - silver) * 2))
    elif silver < 30:
        return int(50 + (30 - silver) / 5 * 20)
    elif silver < 35:
        return int(30 + (35 - silver) / 5 * 20)
    elif silver < 40:
        return int(15 + (40 - silver) / 5 * 15)
    else:
        return max(0, int(15 - (silver - 40) * 1))


def score_brent(brent: float) -> int:
    """Brent crude scoring. Same logic as WTI."""
    if brent is None:
        return 0
    if brent < 75:
        return min(100, int(80 + (75 - brent) * 2))
    elif brent < 90:
        return int(60 + (90 - brent) / 15 * 20)
    elif brent < 105:
        return int(40 + (105 - brent) / 15 * 20)
    elif brent < 125:
        return int(20 + (125 - brent) / 20 * 20)
    else:
        return max(0, int(20 - (brent - 125) * 1))


def score_eurusd(eurusd: float) -> int:
    """EUR/USD scoring. Strong EUR = weak USD = risk-on."""
    if eurusd is None:
        return 0
    if eurusd > 1.15:
        return min(100, int(80 + (eurusd - 1.15) * 100))
    elif eurusd > 1.10:
        return int(60 + (eurusd - 1.10) / 0.05 * 20)
    elif eurusd > 1.05:
        return int(40 + (eurusd - 1.05) / 0.05 * 20)
    elif eurusd > 1.00:
        return int(20 + (eurusd - 1.00) / 0.05 * 20)
    else:
        return max(0, int(eurusd / 1.00 * 20))


def score_usdjpy(usdjpy: float) -> int:
    """USD/JPY scoring. High USD/JPY = risk-on carry trade. Low = risk-off (JPY haven)."""
    if usdjpy is None:
        return 0
    if usdjpy > 150:
        return 40  # extreme carry = complacency risk
    elif usdjpy > 140:
        return 55
    elif usdjpy > 130:
        return 70  # moderate = healthy risk appetite
    elif usdjpy > 120:
        return 60
    elif usdjpy > 110:
        return 45  # JPY strengthening = risk-off
    else:
        return max(0, int(30 - (110 - usdjpy) * 1))


# ═══════════════════════════════════════════════════════════════
# Risk Appetite Proxies
# ═══════════════════════════════════════════════════════════════

def score_btc(btc_data: dict) -> Optional[int]:
    """Bitcoin as speculative appetite proxy. Rising BTC = extreme risk-on."""
    if not btc_data:
        return None
    ret_1m = btc_data.get("ret_1m_pct")
    if ret_1m is None:
        return 50
    # BTC is a contrarian indicator at extremes
    if ret_1m > 30:
        return 25  # extreme speculation = warning
    elif ret_1m > 15:
        return 40
    elif ret_1m > 5:
        return 55  # healthy risk appetite
    elif ret_1m > -5:
        return 60
    elif ret_1m > -15:
        return 50
    elif ret_1m > -30:
        return 40
    else:
        return 30  # crash = fear contagion


def score_eem(eem_data: dict) -> Optional[int]:
    """EEM (Emerging Markets) as global risk appetite proxy."""
    if not eem_data:
        return None
    ret_1m = eem_data.get("ret_1m_pct")
    if ret_1m is None:
        return 50
    if ret_1m > 5:
        return min(100, int(70 + ret_1m * 2))
    elif ret_1m > 2:
        return int(60 + (ret_1m - 2) / 3 * 10)
    elif ret_1m > 0:
        return int(50 + ret_1m / 2 * 10)
    elif ret_1m > -3:
        return int(40 + (ret_1m + 3) / 3 * 10)
    elif ret_1m > -7:
        return int(25 + (ret_1m + 7) / 4 * 15)
    else:
        return max(0, int(25 + ret_1m))


def score_sox(sox_data: dict) -> Optional[int]:
    """SOX (Semiconductor Index) as tech/economic cycle proxy."""
    if not sox_data:
        return None
    ret_1m = sox_data.get("ret_1m_pct")
    if ret_1m is None:
        return 50
    if ret_1m > 10:
        return min(100, int(75 + (ret_1m - 10) * 1))
    elif ret_1m > 5:
        return int(65 + (ret_1m - 5) / 5 * 10)
    elif ret_1m > 0:
        return int(50 + ret_1m / 5 * 15)
    elif ret_1m > -5:
        return int(35 + (ret_1m + 5) / 5 * 15)
    elif ret_1m > -10:
        return int(20 + (ret_1m + 10) / 5 * 15)
    else:
        return max(0, int(20 + ret_1m))


def compute_geopolitical_risk(market_data: dict) -> dict:
    """
    Composite geopolitical risk indicator from VIX, Gold, Oil anomalies.
    Returns: {score: 0-100 (0=high risk), signals: [str]}
    """
    signals = []
    risk_score = 100  # start at 100 (no risk), deduct for each signal

    p = market_data.get("prices", {})
    m = market_data.get("macro", {})

    vix = p.get("vix")
    gold = m.get("gold")
    oil = m.get("wti_oil")

    # VIX spike check
    if vix and vix > 30:
        signals.append(f"VIX={vix:.1f} (>30 恐慌)")
        risk_score -= 25
    elif vix and vix > 25:
        signals.append(f"VIX={vix:.1f} (>25 偏高)")
        risk_score -= 15

    # Gold spike (proxy for geopolitical fear)
    if gold and gold > 2800:
        signals.append(f"Gold=${gold:.0f} (>2800 極端避險)")
        risk_score -= 20
    elif gold and gold > 2500:
        signals.append(f"Gold=${gold:.0f} (>2500 避險需求高)")
        risk_score -= 10

    # Oil spike (supply disruption risk)
    if oil and oil > 100:
        signals.append(f"WTI=${oil:.0f} (>100 供給風險)")
        risk_score -= 20
    elif oil and oil > 90:
        signals.append(f"WTI=${oil:.0f} (>90 地緣溢價)")
        risk_score -= 10

    # Combined: Gold up + Oil up + VIX up = classic geopolitical shock
    if len(signals) >= 2:
        risk_score -= 10  # compounding effect

    return {
        "score": max(0, min(100, risk_score)),
        "signals": signals,
        "level": "🔴 高風險" if risk_score < 50 else "🟡 中度風險" if risk_score < 75 else "🟢 低風險",
    }


# ═══════════════════════════════════════════════════════════════
# Config-driven scoring (loads thresholds from config.json)
# ═══════════════════════════════════════════════════════════════

def load_config() -> dict:
    """Load scoring configuration from config.json."""
    import json, os
    config_path = os.path.join(os.path.dirname(__file__), "..", "config.json")
    try:
        with open(config_path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def get_benchmarks(market: str) -> dict:
    """Get benchmark values for a market from config."""
    config = load_config()
    return config.get("markets", {}).get(market, {}).get("benchmarks", {})


def get_weights() -> dict:
    """Get dimension weights from config."""
    config = load_config()
    return config.get("weights", {
        "valuation": 0.30, "flow": 0.25, "technical": 0.20, "macro": 0.25
    })


def get_risk_levels() -> list:
    """Get risk level definitions from config."""
    config = load_config()
    return config.get("risk_levels", [
        {"min": 80, "max": 100, "level": "🟢 極度安全", "equity_pct": "80-100%", "signal": "全力做多"},
        {"min": 65, "max": 80,  "level": "🟢 安全",     "equity_pct": "70-85%",  "signal": "偏多配置"},
        {"min": 50, "max": 65,  "level": "🟡 中性",     "equity_pct": "55-70%",  "signal": "標準配置"},
        {"min": 35, "max": 50,  "level": "🟠 謹慎",     "equity_pct": "40-55%",  "signal": "降低曝險"},
        {"min": 20, "max": 35,  "level": "🔴 風險偏高",  "equity_pct": "25-40%",  "signal": "防禦配置"},
        {"min": 0,  "max": 20,  "level": "🔴🔴 極度危險","equity_pct": "<25%",    "signal": "現金為主"},
    ])


# ═══════════════════════════════════════════════════════════════
# Composite
# ═══════════════════════════════════════════════════════════════

def composite_score(
    valuation: float,
    flow: float,
    technical: float,
    macro: float,
) -> float:
    """Weighted composite: valuation 30% + flow 25% + technical 20% + macro 25%."""
    return (
        valuation * 0.30
        + flow * 0.25
        + technical * 0.20
        + macro * 0.25
    )


def risk_level(score: float) -> dict:
    """Map composite score to risk level and allocation recommendation."""
    if score >= 80:
        return {"level": "🟢 極度安全", "equity_pct": "80-100%", "signal": "全力做多"}
    elif score >= 65:
        return {"level": "🟢 安全", "equity_pct": "70-85%", "signal": "偏多配置"}
    elif score >= 50:
        return {"level": "🟡 中性", "equity_pct": "55-70%", "signal": "標準配置"}
    elif score >= 35:
        return {"level": "🟠 謹慎", "equity_pct": "40-55%", "signal": "降低曝險"}
    elif score >= 20:
        return {"level": "🔴 風險偏高", "equity_pct": "25-40%", "signal": "防禦配置"}
    else:
        return {"level": "🔴🔴 極度危險", "equity_pct": "<25%", "signal": "現金為主"}


def aaii_score(bullish: float, bearish: float) -> int:
    """AAII sentiment → contrarian score. High bearish = buy signal."""
    if bullish is None or bearish is None:
        return 0
    spread = bearish - bullish
    if spread > 20:
        return min(100, int(80 + (spread - 20) * 1))
    elif spread > 10:
        return int(70 + (spread - 10) / 10 * 10)
    elif spread > 0:
        return int(60 + spread / 10 * 10)
    elif spread > -10:
        return int(40 + (spread + 10) / 10 * 20)
    else:
        return max(0, int(30 + (spread + 10) * 1))