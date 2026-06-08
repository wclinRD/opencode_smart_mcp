#!/usr/bin/env python3
"""
Stock Quantitative Analyzer — Main Orchestrator
================================================
Modular pipeline: fetchers → scrapers → scoring → report.

Usage:
    python3 quant_analyzer.py --market us --mode quick
    python3 quant_analyzer.py --market tw --mode full
    python3 quant_analyzer.py --market both --mode quick --save-obsidian
    python3 quant_analyzer.py --market us --mode full --output report
"""

import argparse
import calendar
import json
import os
import sys
from datetime import datetime
from enum import Enum
from typing import Any, Optional

# ── Internal modules ──
from fetchers import fetch_us_market, fetch_tw_market

# Compute calendar search months
_now = datetime.now()
CALENDAR_MONTH = _now.strftime("%B %Y")  # e.g. "June 2026"
NEXT_MONTH = datetime(_now.year + _now.month // 12, (_now.month % 12) + 1, 1).strftime("%B %Y")
from scrapers import fetch_all_scrapers
from scoring import (
    score_pe, score_cape, score_erp, score_fwd_pe, score_mkt_gdp,
    score_bofa_bb, score_ig_oas, score_hy_oas, score_equity_flow, score_hf_exposure,
    score_ma_deviation, score_vix, score_rsi, score_breadth, score_put_call,
    score_core_pce, score_fed_path, score_yield_curve, score_recession_prob, score_oil,
    score_dxy, score_credit_etf, score_gold, score_tlt,
    score_copper, score_silver, score_brent, score_eurusd, score_usdjpy,
    score_btc, score_eem, score_sox, compute_geopolitical_risk,
    score_tw_price_pct, score_tw_volume_ratio,
    aaii_score,
    composite_score, risk_level,
    get_weights, get_risk_levels,
)
from cache import get_stats as cache_stats, invalidate as cache_clear
from history import save as history_save, compare as history_compare, get_previous


# ═══════════════════════════════════════════════════════════════
# Error Levels
# ═══════════════════════════════════════════════════════════════

class ErrorLevel(Enum):
    WARN = "WARN"        # Non-critical, report continues
    ERROR = "ERROR"      # Data source failed, indicator skipped
    CRITICAL = "CRITICAL"  # Core data failed, results may be unreliable


def _err(level: ErrorLevel, source: str, msg: str) -> dict:
    return {"level": level.value, "source": source, "message": msg}


# ═══════════════════════════════════════════════════════════════
# Scoring Engine
# ═══════════════════════════════════════════════════════════════

def compute_all_scores(market_data: dict, scraper_data: dict, market: str) -> dict:
    """Compute all indicator scores from market + scraper data."""
    scores = {}
    p = market_data.get("prices", {})
    v = market_data.get("valuation", {})
    t = market_data.get("technical", {})
    m = market_data.get("macro", {})
    is_tw = market == "tw"

    # ── Valuation ──
    pe = v.get("pe_trailing")
    benchmark_pe = 15.5 if is_tw else 17.6
    scores["pe"] = {"value": pe, "score": score_pe(pe, benchmark_pe) if pe else None, "auto": bool(pe)}

    # Forward P/E: try scraper first (vcpscanner.com), fall back to yfinance, then estimate
    fwd_pe = v.get("pe_forward")
    fwd_pe_scraper = scraper_data.get("fwd_pe", {}).get("fwd_pe") if scraper_data else None
    if fwd_pe_scraper:
        fwd_pe = fwd_pe_scraper
    elif not fwd_pe and pe:
        # Estimate: forward ≈ trailing / (1 + 8% consensus growth)
        fwd_pe = round(pe / 1.08, 1)
    scores["fwd_pe"] = {"value": fwd_pe, "score": score_fwd_pe(fwd_pe) if fwd_pe else None, "auto": bool(fwd_pe)}

    erp_score = score_erp(pe, m.get("yield_10y")) if pe and m.get("yield_10y") else None
    erp_val = round((1.0 / pe * 100) - m["yield_10y"], 2) if (pe and pe > 0 and m.get("yield_10y")) else None
    scores["erp"] = {"value": erp_val, "score": erp_score, "auto": bool(erp_score)}

    cape_data = scraper_data.get("cape", {})
    cape_val = cape_data.get("cape") if cape_data else None
    scores["cape"] = {"value": cape_val, "score": score_cape(cape_val) if cape_val else None, "auto": bool(cape_val), "source": "multpl.com"}

    # Market cap / GDP (Buffett Indicator) from vcpscanner S&P 500 mkt cap + GDP estimate
    mkt_gdp_val = scraper_data.get("mkt_gdp") if scraper_data else None
    scores["mkt_gdp"] = {"value": mkt_gdp_val, "score": score_mkt_gdp(mkt_gdp_val) if mkt_gdp_val else None, "auto": bool(mkt_gdp_val), "source": "vcpscanner.com"}

    # ── Fund Flow / Credit (5 indicators) ──
    # Credit ETF proxies (free alternatives to OAS)
    credit_etfs = market_data.get("credit_etfs", {})
    hyg_data = credit_etfs.get("hyg", {})
    lqd_data = credit_etfs.get("lqd", {})
    tlt_data = credit_etfs.get("tlt", {})

    hyg_score = score_credit_etf(hyg_data)
    lqd_score = score_credit_etf(lqd_data)
    tlt_score = score_tlt(tlt_data)

    scores["hyg_credit"] = {
        "value": f"${hyg_data.get('price', 'N/A')} (1M: {hyg_data.get('ret_1m_pct', 'N/A')}%)",
        "score": hyg_score,
        "auto": bool(hyg_score is not None),
        "source": "yfinance HYG (HY信用proxy)",
    }
    scores["lqd_credit"] = {
        "value": f"${lqd_data.get('price', 'N/A')} (1M: {lqd_data.get('ret_1m_pct', 'N/A')}%)",
        "score": lqd_score,
        "auto": bool(lqd_score is not None),
        "source": "yfinance LQD (IG信用proxy)",
    }
    scores["tlt_safety"] = {
        "value": f"${tlt_data.get('price', 'N/A')} (1M: {tlt_data.get('ret_1m_pct', 'N/A')}%)",
        "score": tlt_score,
        "auto": bool(tlt_score is not None),
        "source": "yfinance TLT (避險需求proxy)",
    }

    # Gold, Silver, Copper (via ETFs for reliable pricing)
    commodities = market_data.get("commodities", {})
    gld_price = commodities.get("gld")
    slv_price = commodities.get("slv")
    cper_price = commodities.get("cper")

    # GLD ~1/10 oz → approximate gold price
    gold_approx = round(gld_price * 10, 1) if gld_price else None
    gold_score = score_gold(gold_approx)
    scores["gold"] = {
        "value": gold_approx,
        "score": gold_score,
        "auto": bool(gold_approx),
        "source": "yfinance GLD (黃金ETF)",
    }

    silver_score = score_silver(slv_price) if slv_price else None
    scores["silver"] = {
        "value": slv_price,
        "score": silver_score,
        "auto": bool(slv_price),
        "source": "yfinance SLV (白銀ETF)",
    }

    # CPER tracks copper futures
    copper_approx = round(cper_price * 0.16, 2) if cper_price else None  # ~$28 CPER ≈ $4.50 copper
    copper_score = score_copper(copper_approx)
    scores["copper"] = {
        "value": copper_approx,
        "score": copper_score,
        "auto": bool(copper_approx),
        "source": "yfinance CPER (銅ETF)",
    }

    # Brent, FX
    brent_val = m.get("brent_oil")
    if brent_val:
        scores["brent"] = {"value": brent_val, "score": score_brent(brent_val), "auto": True, "source": "yfinance BZ=F"}
    eur_val = m.get("eurusd")
    if eur_val:
        scores["eurusd"] = {"value": eur_val, "score": score_eurusd(eur_val), "auto": True, "source": "yfinance"}
    jpy_val = m.get("usdjpy")
    if jpy_val:
        scores["usdjpy"] = {"value": jpy_val, "score": score_usdjpy(jpy_val), "auto": True, "source": "yfinance"}

    # BofA B&B — from scraper or Exa search
    bofa = scraper_data.get("bofa_bb") if scraper_data else None
    scores["bofa_bb"] = {"value": bofa, "score": score_bofa_bb(bofa) if bofa else None, "auto": False, "source": "Exa search"}

    scores["ig_oas"] = {"value": None, "score": None, "auto": False, "source": "Exa search (FRED BAMLC0A0CM)"}
    scores["hy_oas"] = {"value": None, "score": None, "auto": False, "source": "Exa search (FRED BAMLH0A0HYM2)"}
    scores["equity_flow"] = {"value": None, "score": None, "auto": False, "source": "Exa search"}
    scores["hf_exposure"] = {"value": None, "score": None, "auto": False, "source": "Exa search (Goldman Sachs PB)"}

    # ── Technical (5 indicators) ──
    dev = t.get("deviation_pct")
    scores["ma200_deviation"] = {"value": dev, "score": score_ma_deviation(dev) if dev is not None else None, "auto": bool(dev is not None)}

    vix = p.get("vix")
    scores["vix"] = {"value": vix, "score": score_vix(vix) if vix else None, "auto": bool(vix)}

    rsi = t.get("rsi_14")
    scores["rsi"] = {"value": rsi, "score": score_rsi(rsi) if rsi else None, "auto": bool(rsi)}

    breadth = t.get("breadth", {})
    breadth_val = breadth.get("pct_above_200ma") if breadth else None
    scores["breadth"] = {"value": breadth_val, "score": score_breadth(breadth_val) if breadth_val else None, "auto": bool(breadth_val)}

    pcr_data = scraper_data.get("put_call", {}) if scraper_data else {}
    pcr_val = pcr_data.get("pcr") if pcr_data else None
    scores["put_call"] = {"value": pcr_val, "score": score_put_call(pcr_val) if pcr_val else None, "auto": bool(pcr_val), "source": "CBOE via scrape"}

    # ── Macro (5 indicators) ──
    scores["core_pce"] = {"value": None, "score": None, "auto": False, "source": "Exa search (BLS)"}

    fed_data = scraper_data.get("fedwatch", {}) if scraper_data else {}
    fed_val = fed_data.get("hike_prob") if fed_data else None
    scores["fed_path"] = {"value": fed_val, "score": score_fed_path(fed_val) if fed_val else None, "auto": bool(fed_val), "source": "CME FedWatch"}

    spread = m.get("spread_10y_2y")
    scores["yield_curve"] = {"value": spread, "score": score_yield_curve(spread) if spread is not None else None, "auto": bool(spread is not None)}

    # Recession probability from Cleveland Fed
    rp = scraper_data.get("recession_prob") if scraper_data else None
    scores["recession_prob"] = {"value": rp, "score": score_recession_prob(rp) if rp is not None else None, "auto": rp is not None, "source": "Cleveland Fed"}

    oil = m.get("wti_oil")
    scores["oil"] = {"value": oil, "score": score_oil(oil) if oil else None, "auto": bool(oil)}

    # ── DXY (bonus macro) ──
    dxy = m.get("dxy")
    if dxy:
        scores["dxy"] = {"value": dxy, "score": score_dxy(dxy), "auto": True, "source": "yfinance DX-Y.NYB"}

    # ── Risk Appetite Proxies ──
    risk_proxies = market_data.get("risk_proxies", {})
    for key, func, label in [
        ("btc", score_btc, "BTC 投機情緒"),
        ("eem", score_eem, "EEM 全球風險偏好"),
        ("sox", score_sox, "SOX 科技週期"),
    ]:
        data = risk_proxies.get(key, {})
        s = func(data) if data else None
        scores[key] = {
            "value": f"${data.get('price', 'N/A')} (1M: {data.get('ret_1m_pct', 'N/A')}%)",
            "score": s,
            "auto": bool(s is not None),
"source": "yfinance",
    }

    # ── Geopolitical Risk Composite ──
    geo_risk = compute_geopolitical_risk(market_data)
    scores["geopolitical_risk"] = {
        "value": geo_risk["level"],
        "score": geo_risk["score"],
        "auto": True,
        "source": "複合指標 (VIX+Gold+Oil)",
        "signals": geo_risk["signals"],
    }

    # ── Sector Rotation ──
    sectors = market_data.get("sectors", {})
    if sectors:
        sector_returns = {k: v.get("ret_1m_pct", 0) or 0 for k, v in sectors.items()}
        if sector_returns:
            leader = max(sector_returns, key=sector_returns.get)
            laggard = min(sector_returns, key=sector_returns.get)
            names = {"xlf": "金融", "xlk": "科技", "xle": "能源", "xlu": "公用事業"}
            defensive_ret = sector_returns.get("xlu", 0)
            cyclical_ret = max(sector_returns.get("xlf", 0), sector_returns.get("xlk", 0))
            rotation_score = 65 if cyclical_ret > defensive_ret else 35
            scores["sector_rotation"] = {
                "value": f"領先: {names.get(leader,leader)}({sector_returns[leader]:+.1f}%) / 落後: {names.get(laggard,laggard)}({sector_returns[laggard]:+.1f}%)",
                "score": rotation_score,
                "auto": True,
                "source": "yfinance sector ETFs",
            }

    # ── AAII (bonus sentiment) ──
    aaii_data = scraper_data.get("aaii", {}) if scraper_data else {}
    if aaii_data and aaii_data.get("bullish") is not None:
        scores["aaii_sentiment"] = {
            "value": f"Bull:{aaii_data['bullish']}% Bear:{aaii_data['bearish']}%",
            "score": aaii_score(aaii_data["bullish"], aaii_data["bearish"]),
            "auto": True,
            "source": "AAII.com",
        }

    # ── TW market: filter to relevant indicators only ──
    if is_tw:
        keep = {"pe", "fwd_pe", "erp", "ma200_deviation", "vix", "rsi", "yield_curve", "dxy",
                "bofa_bb", "ig_oas", "hy_oas", "breadth", "put_call",
                "core_pce", "fed_path", "recession_prob",
                "oil", "brent", "eurusd", "usdjpy", "gold", "silver", "copper",
                "btc", "eem", "sox", "geopolitical_risk",
                "price_pct_52w", "volume_ratio"}
        # Add TW-specific indicators
        scores["tw_pe"] = scores.get("pe", {})

        # Add price percentile scoring
        pct_52w = t.get("price_pct_52w")
        scores["price_pct_52w"] = {"value": pct_52w, "score": score_tw_price_pct(pct_52w) if pct_52w is not None else None, "auto": pct_52w is not None}

        # Add volume ratio scoring
        vol_ratio = t.get("volume_ratio")
        scores["volume_ratio"] = {"value": vol_ratio, "score": score_tw_volume_ratio(vol_ratio) if vol_ratio is not None else None, "auto": vol_ratio is not None}

        # Set non-applicable to None
        for k in list(scores.keys()):
            if k not in keep:
                if not k.startswith("tw_"):
                    scores.pop(k, None)
        # Recompute ERP with TW yield if available
        tw_10y = market_data.get("macro", {}).get("yield_10y")
        if scores.get("pe", {}).get("score") and tw_10y:
            pass  # already computed

    return scores


def compute_dimension_scores(scores: dict, market: str = "us") -> dict:
    """Compute weighted dimension averages from individual indicator scores."""
    is_tw = market == "tw"
    dims = {
        "valuation": {"indicators": ["pe", "fwd_pe", "erp"] + ([] if is_tw else ["cape", "mkt_gdp"]), "weight": 0.30, "scores": []},
        "flow": {"indicators": [] if is_tw else ["hyg_credit", "lqd_credit", "tlt_safety", "bofa_bb", "ig_oas", "hy_oas", "equity_flow", "hf_exposure"], "weight": 0.25, "scores": []},
        "technical": {"indicators": ["ma200_deviation", "rsi"] + ([] if is_tw else ["vix", "breadth", "put_call"]) + (["price_pct_52w", "volume_ratio"] if is_tw else []), "weight": 0.20, "scores": []},
        "macro": {"indicators": [] if is_tw else ["core_pce", "fed_path", "yield_curve", "recession_prob", "oil", "brent", "dxy", "eurusd", "usdjpy", "gold", "silver", "copper", "btc", "eem", "sox", "geopolitical_risk", "sector_rotation"], "weight": 0.25, "scores": []},
    }

    result = {}
    for dim_name, dim_info in dims.items():
        dim_scores = []
        for ind in dim_info["indicators"]:
            s = scores.get(ind, {}).get("score")
            if s is not None:
                dim_scores.append(s)
        avg = round(sum(dim_scores) / len(dim_scores), 1) if dim_scores else 0
        result[dim_name] = {
            "avg_score": avg,
            "available": len(dim_scores),
            "total": len(dim_info["indicators"]),
            "weight": dim_info["weight"],
        }

    # Composite — redistribute weights if some dimensions are empty
    if is_tw:
        available_dims = {k: v for k, v in result.items() if v["available"] > 0}
        active_names = list(available_dims.keys())
        if active_names:
            equal_weight = 1.0 / len(active_names)
            comp = sum(result[n]["avg_score"] * equal_weight for n in active_names)
        else:
            comp = 0.0
    else:
        comp = composite_score(
            result["valuation"]["avg_score"],
            result["flow"]["avg_score"],
            result["technical"]["avg_score"],
            result["macro"]["avg_score"],
        )
    result["composite"] = round(comp, 1)
    result["risk"] = risk_level(comp)

    return result


# ═══════════════════════════════════════════════════════════════
# Universal Event Context Engine
# ═══════════════════════════════════════════════════════════════

def compute_event_context() -> dict:
    """Universal event context for any analysis date.

    Uses calendar-based generic patterns (not hardcoded dates) to identify
    upcoming events that could affect market data evaluation. Designed to
    work for any date, any market, any time.

    Covers: earnings season phases (sector-level), ex-dividend season,
    Fed/FOMC blackout, options expiry, quarter-end rebalancing,
    key data release windows.
    """
    now = datetime.now()
    today = now.date()
    day = today.day
    month = now.month
    year = now.year
    weekday = today.weekday()
    week_of_month = (day - 1) // 7 + 1
    quarter = (month - 1) // 3 + 1
    quarter_month = month - (quarter - 1) * 3

    months_en = ["January","February","March","April","May","June",
                 "July","August","September","October","November","December"]
    cur_month_name = months_en[month - 1]

    notes = []
    event_prompts = []

    # ── 1. Earnings Season (sector-level, universal) ──
    earnings_phase = None
    earnings_sectors = []
    if quarter_month == 1:
        if week_of_month <= 2:
            earnings_phase = "季末掃尾 (前季財報季尾聲)"
        elif week_of_month <= 3:
            if quarter == 1:
                earnings_phase = "Q4 財報季展開 (銀行先行)"
                earnings_sectors = ["大型銀行(JPM/BAC/WFC)公布Q4業績"]
            elif quarter == 2:
                earnings_phase = "Q1 財報季尾聲"
                earnings_sectors = ["消費/能源公司公布Q1"]
            elif quarter == 3:
                earnings_phase = "Q2 財報季尾聲"
                earnings_sectors = ["能源/原物料壓軸"]
            else:
                earnings_phase = "Q3 財報季尾聲"
        else:
            if quarter == 1:
                earnings_phase = "Q4 財報季全面展開"
                earnings_sectors = ["科技巨頭(MSFT/AAPL/GOOGL/AMZN)","半導體(INTC/QCOM)"]
            elif quarter == 2:
                earnings_phase = "Q1 財報季收尾"
            else:
                earnings_phase = "季後淡季"
    elif quarter_month == 2:
        if quarter == 1:
            earnings_phase = "Q4 財報季高峰"
            earnings_sectors = ["零售(WMT/COST/HOME)、消費品(PG/KO)"]
        elif quarter == 2:
            earnings_phase = "Q1 財報季高峰"
            earnings_sectors = ["科技巨頭集中在Apr第3-4週","半導體(AVGO/QCOM/AMD)5月中"]
        elif quarter == 3:
            earnings_phase = "Q2 財報季高峰"
            earnings_sectors = ["銀行(JPM/GS/BAC)7月中旬揭幕","科技巨頭7月第3-4週"]
        else:
            earnings_phase = "Q3 財報季高峰"
            earnings_sectors = ["銀行10月中旬揭幕Q3","科技巨頭10月第3-4週"]
        if week_of_month >= 3:
            earnings_sectors.append("多數已公布，留意營收指引")
    else:
        if week_of_month <= 2:
            earnings_phase = "財報季收尾"
            earnings_sectors = ["少數公司壓軸公布"]
        else:
            earnings_phase = "財報空窗期"
            notes.append("🔭 財報空窗期 — profit warning / pre-announcement 頻段")
    if earnings_phase:
        notes.append(f"📰 **{earnings_phase}**")
        for s in earnings_sectors:
            notes.append(f"   · {s}")

    # ── 2. Ex-Dividend Season ──
    if month in [2, 5, 8, 11] and week_of_month >= 2:
        notes.append(f"💰 美股除息密集期 ({cur_month_name}下半月，大量ETF除息)")
        event_prompts.append(f"S&P 500 ex-dividend dates {cur_month_name} {year}")
    if month in [3, 6, 9, 12] and week_of_month <= 2:
        notes.append(f"💰 美股除息密集期 ({cur_month_name}月初，季末配息)")
        event_prompts.append(f"major ETFs ex-dividend dates {cur_month_name} {year}")
    if month == 12 and week_of_month >= 2:
        notes.append("🎁 年末ETF資本利得分配(12月中下旬)")
    if 7 <= month <= 9:
        notes.append(f"🇹🇼 台股除權息旺季 ({cur_month_name}～9月)，指數受壓")
        event_prompts.append(f"Taiwan stock ex-dividend calendar {cur_month_name} {year}")
    elif month == 6 and week_of_month >= 3:
        notes.append("🇹🇼 台股除權息旺季即將在7月展開")

    # ── 3. Fed Blackout Period ──
    fomc_months = [1, 3, 5, 6, 7, 9, 11, 12]
    fomc_this_month = month in fomc_months
    fomc_next_month = ((month % 12 + 1) in fomc_months)
    if fomc_this_month:
        if week_of_month == 1:
            notes.append("🔇 Fed靜默期開始 (FOMC約2-3週後)")
        elif week_of_month == 2:
            notes.append("🔇 Fed靜默期中")
        elif week_of_month == 3 and day <= 20:
            notes.append("🔇 Fed靜默期/FOMC本週或下週")
        else:
            notes.append("🟢 Fed靜默期結束，官員可能發表談話")
    elif fomc_next_month:
        notes.append("📅 下月有FOMC，靜默期約兩週後開始")

    # ── 4. Options Expiry (3rd Friday) ──
    cal = calendar.monthcalendar(year, month)
    third_friday = None
    for w in cal:
        if w[calendar.FRIDAY] != 0:
            third_friday = w[calendar.FRIDAY]
    if third_friday:
        week_of_expiry = (third_friday - 1) // 7 + 1
        if week_of_month == week_of_expiry:
            d = third_friday - day
            notes.append(f"📌 本週三期權到期 ({'還有'+str(d)+'天' if d>0 else '就是今天'})" if weekday >= 3 else f"📌 下週三期權到期(週{['一','二','三','四','五'][weekday]})")
        elif week_of_month == week_of_expiry - 1:
            notes.append("📌 下週三期權到期，波動可能放大")
        if quarter_month == 3:
            notes.append("💥 季末期權到期(Quarterly OPEX)，波動放大")

    # ── 5. Quarter-End / Rebalancing ──
    if quarter_month == 3 and week_of_month >= 3:
        notes.append("🔄 季末再平衡(Window Dressing)")
    if month == 12 and week_of_month >= 3:
        notes.append("🎄 稅損出售(Tax-Loss Harvesting)")
    if quarter_month == 1 and week_of_month <= 1:
        notes.append("🔄 季初資金重新配置")

    # ── 6. Key Data Release Window ──
    data_notes = []
    if week_of_month == 1 and weekday < 5:
        data_notes.append("📊 本月非農就業可能於本週五公布")
    if week_of_month == 2:
        data_notes.append("📊 本月 CPI/PPI 可能於本週公布")
    if quarter_month == 3:
        data_notes.append("📊 本季 GDP 初值可能於本月公布")
    if data_notes:
        notes.append("── 經濟數據 ──")
        for n in data_notes:
            notes.append(f"   {n}")

    # ── 7. Search Prompts ──
    event_prompts.append(f"US economic calendar {cur_month_name} {year} key events")
    event_prompts.append(f"S&P 500 earnings calendar this week {cur_month_name} {year}")
    if quarter_month == 2:
        event_prompts.append(f"Q{quarter} earnings season outlook S&P 500")

    return {
        "date": today.isoformat(),
        "week_of_month": week_of_month,
        "quarter": quarter,
        "quarter_month": quarter_month,
        "earnings_phase": earnings_phase,
        "is_fomc_month": fomc_this_month,
        "is_fomc_next_month": fomc_next_month,
        "opex_day": third_friday,
        "notes": notes,
        "search_prompts": event_prompts,
    }


# ═══════════════════════════════════════════════════════════════
# Report Generator
# ═══════════════════════════════════════════════════════════════

def generate_report(market: str, market_data: dict, scores: dict, dims: dict, scraper_data: dict, comparison: dict = None, event_ctx: dict = None) -> str:
    """Generate a structured Markdown report."""
    label = "美股" if market == "us" else "台股"
    index_name = "S&P 500" if market == "us" else "台灣加權指數"
    price = market_data["prices"].get("sp500" if market == "us" else "twii", "N/A")
    ts = market_data.get("timestamp", "")[:10]

    lines = []
    lines.append(f"# {label}量化評估報告 — {ts}")
    lines.append("")
    lines.append(f"> **{index_name}：** {price}　｜　**資料時間：** {market_data.get('timestamp', '')[:19]}")
    lines.append(f"> **模式：** auto-scores only　｜　**方法論：** [[美股量化評估方法論]]")
    lines.append("")

    # ── Composite Score Card ──
    lines.append("## 📊 綜合評分卡")
    lines.append("")
    lines.append("| 面向 | 分數 | 權重 | 加權 | 覆蓋 |")
    lines.append("|:----:|:---:|:---:|:---:|:---:|")
    for dim_name, dim_info in dims.items():
        if dim_name in ("composite", "risk"):
            continue
        score_str = f"{dim_info['avg_score']}/100" if dim_info['available'] > 0 else "—"
        weighted = round(dim_info['avg_score'] * dim_info['weight'], 1) if dim_info['available'] > 0 else "—"
        coverage = f"{dim_info['available']}/{dim_info['total']}"
        lines.append(f"| {dim_name} | {score_str} | {int(dim_info['weight']*100)}% | {weighted} | {coverage} |")

    lines.append(f"| **綜合** | **{dims['composite']}/100** | — | — | — |")
    lines.append("")

    risk = dims["risk"]
    lines.append(f"## 🎯 風險等級：{risk['level']}　｜　建議股票曝險：{risk['equity_pct']}")
    lines.append(f"> 信號：**{risk['signal']}**")
    lines.append("")

    # ── Comparison ──
    if comparison and comparison.get("available"):
        lines.append("## 📈 與上期對比")
        lines.append("")
        lines.append(f"> 上期綜合分數：**{comparison['previous_composite']}/100**（{comparison.get('previous_date', '')}）")
        lines.append(f"> 本期變動：**{comparison['composite_delta']:+.1f}**　→　{comparison['direction']}")
        if comparison.get("changes"):
            lines.append("")
            lines.append("| 面向 | 變動 |")
            lines.append("|:----:|:---:|")
            for dim, delta in comparison["changes"].items():
                arrow = "↑" if delta > 0 else "↓" if delta < 0 else "→"
                lines.append(f"| {dim} | {arrow} {delta:+.1f} |")
        lines.append("")

    # ── Dimension Details ──
    indicator_labels = {
        "pe": ("P/E (Trailing)", ""),
        "fwd_pe": ("Forward P/E", ""),
        "erp": ("股票風險溢價", "%"),
        "cape": ("Shiller CAPE", ""),
        "mkt_gdp": ("市值/GDP", ""),
        "hyg_credit": ("HYG 信用proxy", ""),
        "lqd_credit": ("LQD 信用proxy", ""),
        "tlt_safety": ("TLT 避險proxy", ""),
        "gold": ("黃金", "$"),
        "bofa_bb": ("BofA Bull & Bear", ""),
        "ig_oas": ("IG 信用利差", "%"),
        "hy_oas": ("HY 信用利差", "%"),
        "equity_flow": ("股票資金流", ""),
        "hf_exposure": ("避險基金曝險", ""),
        "ma200_deviation": ("200MA 偏離", "%"),
        "vix": ("VIX", ""),
        "rsi": ("RSI (14日)", ""),
        "breadth": ("市場寬度", "%"),
        "put_call": ("Put/Call Ratio", ""),
        "core_pce": ("核心 PCE", "%"),
        "fed_path": ("Fed 升息機率", "%"),
        "yield_curve": ("10Y-2Y 利差", "%"),
        "recession_prob": ("衰退機率", "%"),
        "oil": ("WTI 原油", "$"),
        "dxy": ("美元指數 DXY", ""),
        "silver": ("白銀", "$"),
        "copper": ("銅 (Dr.Copper)", "$"),
        "brent": ("布蘭特原油", "$"),
        "eurusd": ("EUR/USD", ""),
        "usdjpy": ("USD/JPY", ""),
        "btc": ("BTC 投機情緒", ""),
        "eem": ("EEM 新興市場", ""),
        "sox": ("SOX 半導體", ""),
        "geopolitical_risk": ("地緣政治風險", ""),
        "sector_rotation": ("板塊輪動", ""),
        "aaii_sentiment": ("AAII 情緒", ""),
    }

    dim_order = [
        ("估值面", "valuation", ["pe", "fwd_pe", "erp", "cape", "mkt_gdp"]),
        ("資金流/信用面", "flow", ["hyg_credit", "lqd_credit", "tlt_safety", "bofa_bb", "ig_oas", "hy_oas", "equity_flow", "hf_exposure"]),
        ("技術面", "technical", ["ma200_deviation", "vix", "rsi", "breadth", "put_call"]),
        ("總經面", "macro", ["core_pce", "fed_path", "yield_curve", "recession_prob", "oil", "brent", "dxy", "eurusd", "usdjpy", "gold", "silver", "copper", "btc", "eem", "sox", "geopolitical_risk", "sector_rotation"]),
    ]

    for dim_title, dim_key, indicators in dim_order:
        dim_info = dims.get(dim_key, {})
        if dim_info.get("available", 0) == 0:
            continue  # skip empty dimensions (e.g. TW market flow/macro)
        lines.append(f"### {dim_title}")
        lines.append("")
        lines.append("| # | 指標 | 數值 | 分數 | 來源 |")
        lines.append("|:--|:-----|:----:|:---:|:----:|")
        for i, ind in enumerate(indicators, 1):
            s = scores.get(ind, {})
            label, unit = indicator_labels.get(ind, (ind, ""))
            val = s.get("value")
            score_val = s.get("score")
            source = "✅ auto" if s.get("auto") else s.get("source", "🔍 需查詢")

            val_str = f"{val}{unit}" if val is not None else "—"
            score_str = str(score_val) if score_val is not None else "—"
            lines.append(f"| {i} | {label} | {val_str} | {score_str} | {source} |")
        lines.append("")

    # ── AAII bonus ──
    if "aaii_sentiment" in scores:
        s = scores["aaii_sentiment"]
        lines.append(f"### 🧠 散戶情緒 (AAII)")
        lines.append(f"> {s['value']}　→　Contrarian Score: **{s['score']}/100**")
        lines.append("")

    # ── Signal Integration ──
    lines.append("### ⚡ 信號集成")
    lines.append("")
    signal_rules = [
        ("cape", 35, "🔴", "CAPE > 35", lambda s: s.get("value") and s["value"] > 35),
        ("erp", 0, "🔴", "ERP < 0%", lambda s: s.get("value") is not None and s["value"] < 0),
        ("bofa_bb", 8, "🔴", "BofA B&B > 8", lambda s: s.get("value") and s["value"] > 8),
        ("vix", 15, "🟡", "VIX < 15 (complacency)", lambda s: s.get("value") and s["value"] < 15),
        ("vix", 30, "🔴", "VIX > 30 (panic)", lambda s: s.get("value") and s["value"] > 30),
        ("yield_curve", 0, "🔴", "10Y-2Y 倒掛", lambda s: s.get("value") is not None and s["value"] < 0),
        ("rsi", 30, "🟢", "RSI < 30 (超賣)", lambda s: s.get("value") and s["value"] < 30),
        ("rsi", 70, "🔴", "RSI > 70 (超買)", lambda s: s.get("value") and s["value"] > 70),
        ("oil", 100, "🔴", "WTI > $100", lambda s: s.get("value") and s["value"] > 100),
    ]

    bull_signals = []
    bear_signals = []
    lines.append("| 信號 | 狀態 | 方向 |")
    lines.append("|:-----|:---:|:---:|")
    for key, threshold, direction, label, condition in signal_rules:
        s = scores.get(key, {})
        triggered = condition(s)
        status = "⚠️ 觸發" if triggered else "○"
        lines.append(f"| {label} | {status} | {direction} |")
        if triggered:
            if "🟢" in direction:
                bull_signals.append(label)
            else:
                bear_signals.append(label)

    lines.append("")
    lines.append(f"> 🟢 Bull Signals: {len(bull_signals)}　｜　🔴 Bear Signals: {len(bear_signals)}")
    if bear_signals:
        lines.append(f"> ⚠️ 觸發的警示：{', '.join(bear_signals)}")
    lines.append("")

    # ── Auto-coverage stats ──
    auto_count = sum(1 for s in scores.values() if s.get("score") is not None)
    total_count = len(scores)
    lines.append("---")
    lines.append(f"### 📈 自動化覆蓋率：{auto_count}/{total_count}（{round(auto_count/total_count*100)}%）")
    lines.append("")

    # ── Geopolitical Risk Detail ──
    geo = scores.get("geopolitical_risk", {})
    if geo.get("signals"):
        lines.append("### 🌍 地緣政治風險評估")
        lines.append(f"> 綜合分數：**{geo['score']}/100**（{geo['value']}）")
        for sig in geo["signals"]:
            lines.append(f"> ⚠️ {sig}")
        lines.append("")

    # ── Event Context (universal, auto-generated) ──
    lines.append("---")
    lines.append("### 📅 事件情境感知 (Event Context)")
    lines.append("")
    lines.append("> 以下根據當前日期位置自動推算，非寫死；請搭配 Exa search 取得實際日期與市場預期。")
    lines.append("")

    if event_ctx and event_ctx.get("notes"):
        for note in event_ctx["notes"]:
            lines.append(note)
    lines.append("")

    # ── Exa Search Prompts ──
    lines.append("### 🔍 待 Exa Search 補充")
    lines.append("")
    lines.append("以下指標需透過 Exa search 取得最新數據：")
    lines.append("")
    lines.append("```")
    lines.append("# 並行搜尋（全部同時發送）：")
    _m = CALENDAR_MONTH
    _n = NEXT_MONTH
    lines.append(f"1. \"BofA Bull and Bear indicator latest {_m}\"")
    lines.append(f"2. \"US core PCE inflation rate latest\"")
    lines.append(f"3. \"CME FedWatch probability rate hike FOMC {_m}\"")
    lines.append(f"4. \"AAII investor sentiment survey latest week {_m}\"")
    lines.append(f"5. \"S&P 500 year end 2026 target Goldman Sachs Morgan Stanley consensus\"")
    lines.append(f"6. \"major geopolitical events impacting markets {_m}\"")
    lines.append(f"7. \"US stock market news headlines today {datetime.now().strftime('%Y-%m-%d')}\"")
    lines.append(f"8. \"consensus Q2 2026 earnings growth estimate S&P 500\"")
    lines.append(f"9. \"S&P 500 companies reporting earnings this week {_m}\"")
    # Add event context search prompts
    if event_ctx:
        for prompt in event_ctx.get("search_prompts", []):
            lines.append(f"* \"{prompt}\"")
    lines.append("```")
    lines.append("")

    # ── Errors ──
    errors = market_data.get("errors", [])
    if scraper_data and scraper_data.get("errors"):
        errors.extend(scraper_data["errors"])
    if errors:
        lines.append("### ⚠️ 資料收集錯誤")
        for e in errors:
            lines.append(f"- {e}")
        lines.append("")

    lines.append(f"> 🤖 自動化: yfinance + scrapers　｜　🔍 補充: Exa search + webfetch")
    lines.append(f"> 📝 方法論: [[美股量化評估方法論]]　｜　⚠️ 非投資建議，僅供參考")

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# Obsidian Integration
# ═══════════════════════════════════════════════════════════════

def save_to_obsidian(report: str, market: str) -> Optional[str]:
    """Save report to Obsidian vault."""
    config_path = os.path.expanduser("~/.obsidian-wiki/config")
    vault_path = None
    if os.path.exists(config_path):
        with open(config_path) as f:
            for line in f:
                if line.startswith("OBSIDIAN_VAULT_PATH="):
                    vault_path = line.split("=", 1)[1].strip().strip('"')
                    break

    if not vault_path:
        return None

    label = "美股" if market == "us" else "台股"
    date_str = datetime.now().strftime("%Y-%m-%d")
    filename = f"{label}量化評估-{date_str}.md"
    dir_path = os.path.join(vault_path, "40-投資", "42-總經分析")
    os.makedirs(dir_path, exist_ok=True)
    filepath = os.path.join(dir_path, filename)

    with open(filepath, "w") as f:
        f.write(report)

    return filepath


# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Stock Quantitative Analyzer v2.0")
    parser.add_argument("--market", choices=["us", "tw", "both"], default="us", help="Target market")
    parser.add_argument("--mode", choices=["quick", "full"], default="quick", help="Analysis depth")
    parser.add_argument("--output", choices=["json", "report", "both"], default="json", help="Output format")
    parser.add_argument("--save-obsidian", action="store_true", help="Save report to Obsidian vault")
    parser.add_argument("--compare", action="store_true", help="Compare with previous report")
    parser.add_argument("--no-cache", action="store_true", help="Skip cache, force fresh fetch")
    parser.add_argument("--no-scrapers", action="store_true", help="Skip web scrapers")
    parser.add_argument("--cache-stats", action="store_true", help="Show cache statistics and exit")
    parser.add_argument("--clear-cache", action="store_true", help="Clear cache and exit")
    parser.add_argument("--history", action="store_true", help="Show score history and exit")
    args = parser.parse_args()

    # Cache management
    if args.cache_stats:
        print(json.dumps(cache_stats(), indent=2, default=str))
        return
    if args.clear_cache:
        cache_clear()
        print("✅ Cache cleared")
        return
    if args.history:
        from history import get_all
        for mkt in ["us", "tw"]:
            entries = get_all(mkt)
            if entries:
                print(f"\n📊 {mkt.upper()} Score History:")
                print(f"   {'Date':<12} {'Score':>6} {'Risk':<12}")
                print(f"   {'─'*12} {'─'*6} {'─'*12}")
                for e in entries[-10:]:
                    print(f"   {e['timestamp'][:10]:<12} {e['composite']:>5.1f}  {e['risk_level']:<12}")
        return
    if args.no_cache:
        cache_clear()

    results = {}

    for market in (["us", "tw"] if args.market == "both" else [args.market]):
        label = "美股" if market == "us" else "台股"
        print(f"⏳ [{label}] 擷取市場資料...", file=sys.stderr)

        # Step 1: Fetch market data
        fetcher = fetch_us_market if market == "us" else fetch_tw_market
        market_data = fetcher(args.mode)

        # Step 2: Fetch scraper data
        scraper_data = {}
        if not args.no_scrapers and market == "us":
            print(f"⏳ [{label}] 爬取補充資料 (CAPE/AAII/FedWatch)...", file=sys.stderr)
            scraper_data = fetch_all_scrapers()

        # Step 3: Compute scores
        print(f"⏳ [{label}] 計算評分...", file=sys.stderr)
        scores = compute_all_scores(market_data, scraper_data, market)
        dims = compute_dimension_scores(scores, market)

        # Step 4: Event Context (universal calendar pattern)
        event_ctx = compute_event_context()

        # Step 5: Compare with history
        comparison = None
        if args.compare:
            prev = get_previous(market)
            if prev:
                comparison = history_compare(dims, prev)

        # Step 5: Save to history
        history_save(market, dims["composite"], dims)

        results[market] = {
            "data": market_data,
            "scraper_data": scraper_data,
            "scores": scores,
            "dimensions": dims,
            "comparison": comparison,
        }

        # Step 6: Generate report
        report = generate_report(market, market_data, scores, dims, scraper_data, comparison, event_ctx)
        results[market]["report"] = report

        # Step 7: Save to Obsidian
        if args.save_obsidian:
            path = save_to_obsidian(report, market)
            if path:
                results[market]["obsidian_path"] = path

        print(f"✅ [{label}] 完成！綜合分數: {dims['composite']}/100 ({dims['risk']['level']})", file=sys.stderr)

    # Output
    if args.output == "json":
        # Strip reports for clean JSON
        json_out = {}
        for mkt, data in results.items():
            json_out[mkt] = {
                "data": data["data"],
                "scraper_data": data["scraper_data"],
                "scores": data["scores"],
                "dimensions": data["dimensions"],
            }
            if "obsidian_path" in data:
                json_out[mkt]["obsidian_path"] = data["obsidian_path"]
        print(json.dumps(json_out, indent=2, ensure_ascii=False, default=str))
    elif args.output == "report":
        for mkt, data in results.items():
            print(data["report"])
            if "obsidian_path" in data:
                print(f"\n💾 Saved to: {data['obsidian_path']}")
    elif args.output == "both":
        for mkt, data in results.items():
            print(data["report"])
            print("\n--- JSON ---")
            json_out = {
                "data": data["data"],
                "scores": data["scores"],
                "dimensions": data["dimensions"],
            }
            print(json.dumps(json_out, indent=2, ensure_ascii=False, default=str))
            if "obsidian_path" in data:
                print(f"\n💾 Saved to: {data['obsidian_path']}")


if __name__ == "__main__":
    main()