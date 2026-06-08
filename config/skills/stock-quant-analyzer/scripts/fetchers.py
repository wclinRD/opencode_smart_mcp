"""
Market data fetchers via yfinance.
Handles fallbacks, retries, and data validation.
"""

import signal
import time
from datetime import datetime
from typing import Any, Optional

import numpy as np
import pandas as pd
import yfinance as yf

from cache import get as cache_get, set as cache_set, TTL_PRICE, TTL_MEDIUM


# ═══════════════════════════════════════════════════════════════
# Timeout helper (Unix signal-based)
# ═══════════════════════════════════════════════════════════════

class TimeoutError_(Exception):
    pass

def _timeout_call(func, args=None, kwargs=None, timeout=30):
    """Call func with a timeout using SIGALRM (Unix only)."""
    args = args or ()
    kwargs = kwargs or {}

    def _handler(signum, frame):
        raise TimeoutError_(f"Call timed out after {timeout}s")

    old = signal.signal(signal.SIGALRM, _handler)
    signal.alarm(timeout)
    try:
        result = func(*args, **kwargs)
        return result
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


def _ydl(*args, timeout=60, **kwargs):
    """yfinance download with timeout."""
    return _timeout_call(yf.download, args, kwargs, timeout=timeout)


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════

def _safe_float(series) -> Optional[float]:
    """Safely extract float from pandas Series."""
    try:
        val = series.item() if hasattr(series, 'item') else float(series)
        if np.isnan(val) or np.isinf(val):
            return None
        return round(float(val), 4)
    except (ValueError, TypeError, AttributeError):
        return None


def _compute_rsi(closes: pd.Series, period: int = 14) -> Optional[float]:
    """Compute RSI for a price series."""
    if len(closes) < period + 1:
        return None
    delta = closes.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return _safe_float(rsi.iloc[-1])


def _compute_ma_deviation(closes: pd.Series, window: int = 200) -> Optional[dict]:
    """Compute 200MA and deviation."""
    if len(closes) < window:
        return None
    ma = closes.rolling(window=window).mean()
    latest = closes.iloc[-1]
    ma_val = _safe_float(ma.iloc[-1])
    price_val = _safe_float(latest)
    if ma_val and price_val and ma_val > 0:
        deviation = round((price_val - ma_val) / ma_val * 100, 2)
        return {"ma200": round(ma_val, 2), "price": round(price_val, 2), "deviation_pct": deviation}
    return None


# ── Market Breadth (% of stocks above 200MA) ──

_SP500_TICKERS_CACHE: Optional[list[str]] = None

def _get_sp500_tickers() -> list[str]:
    """Get S&P 500 tickers from Wikipedia (cached in memory)."""
    global _SP500_TICKERS_CACHE
    if _SP500_TICKERS_CACHE is not None:
        return _SP500_TICKERS_CACHE
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode()
        tables = pd.read_html(html)
        df = tables[0]
        tickers = df["Symbol"].tolist()
        tickers = [t.replace(".", "-") for t in tickers]
        _SP500_TICKERS_CACHE = tickers
        return tickers
    except Exception:
        # Fallback: common large-cap tickers
        fallback = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "BRK-B", "JPM", "V", "JNJ",
                     "WMT", "PG", "MA", "UNH", "HD", "DIS", "BAC", "ADBE", "CRM", "CMCSA",
                     "NFLX", "XOM", "VZ", "KO", "PEP", "CSCO", "INTC", "ABT", "MRK", "PFE",
                     "AMD", "QCOM", "TMO", "AVGO", "ACN", "LIN", "COST", "DHR", "NEE", "ABBV",
                     "TXN", "IBM", "HON", "PM", "LOW", "UPS", "SBUX", "BA", "CAT", "MS",
                     "DE", "GE", "MMM", "AXP", "BLK", "AMAT", "ADI", "MU", "LRCX", "KLAC",
                     "ORCL", "NOW", "SAP", "CRM", "INTU", "ADP", "FIS", "FISV", "SQ", "PYPL"]
        _SP500_TICKERS_CACHE = fallback
        return fallback


def _compute_breadth(sample_size: int = 100) -> Optional[float]:
    """
    Compute % of S&P 500 stocks above 200-day MA.
    Uses batch yfinance download for efficiency.
    """
    tickers = _get_sp500_tickers()[:sample_size]
    if not tickers:
        return None
    try:
        data = _ydl(tickers, period="1y", progress=False, auto_adjust=True,
                           group_by="ticker", threads=True)
        if data.empty:
            return None
        above = 0
        total = 0
        is_multi = isinstance(data.columns, pd.MultiIndex)
        for t in tickers:
            try:
                if is_multi:
                    if t not in data.columns.get_level_values(0):
                        continue
                    closes = data[t]["Close"].dropna()
                else:
                    closes = data["Close"].dropna() if "Close" in data.columns else None
                if closes is None or len(closes) < 200:
                    continue
                ma200 = closes.rolling(200).mean().iloc[-1]
                price = closes.iloc[-1]
                if ma200 and price > ma200:
                    above += 1
                total += 1
            except (KeyError, IndexError, TypeError):
                continue
        return round(above / total * 100, 1) if total > 0 else None
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════════
# US Market
# ═══════════════════════════════════════════════════════════════

def fetch_us_market(mode: str = "quick") -> dict[str, Any]:
    """Fetch all US market data. Returns structured dict."""
    cache_key = f"us_market_{mode}"
    cached = cache_get(cache_key, TTL_PRICE)
    if cached:
        return cached

    result: dict[str, Any] = {
        "market": "us",
        "timestamp": datetime.now().isoformat(),
        "prices": {},
        "valuation": {},
        "technical": {},
        "macro": {},
        "errors": [],
    }

    # ── Batch download ──
    tickers_map = {
        "sp500": "^GSPC",
        "vix": "^VIX",
        "tnx": "^TNX",
        "irx": "^IRX",
        "oil": "CL=F",       # WTI futures (works reliably)
        "brent": "BZ=F",     # Brent futures
        "dxy": "DX-Y.NYB",
    }

    # Commodity ETFs (more reliable than futures for price levels)
    commodity_etfs = {
        "gld": "GLD",    # Gold ETF (~1/10 oz) → multiply by 10 for gold price
        "slv": "SLV",    # Silver ETF
        "cper": "CPER",  # Copper ETF
    }

    # Credit/risk ETFs (free proxies for credit spreads)
    credit_etfs = {
        "hyg": "HYG",   # High Yield Bond ETF → HY credit proxy
        "lqd": "LQD",   # Investment Grade Bond ETF → IG credit proxy
        "tlt": "TLT",   # 20Y Treasury ETF → long bond proxy
    }

    # Risk appetite / cycle proxies
    risk_tickers = {
        "btc": "BTC-USD",   # Bitcoin → speculative appetite
        "eem": "EEM",       # Emerging Markets → global risk appetite
        "sox": "^SOX",      # Semiconductor Index → tech/economic cycle
    }

    # FX pairs
    fx_tickers = {
        "eurusd": "EURUSD=X",
        "usdjpy": "JPY=X",
    }

    # Sector ETFs for rotation analysis
    sector_etfs = {
        "xlf": "XLF",  # Financials
        "xlk": "XLK",  # Technology
        "xle": "XLE",  # Energy
        "xlu": "XLU",  # Utilities (defensive)
    }

    try:
        data = _ydl(
            list(tickers_map.values()),
            period="1y",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as e:
        result["errors"].append(f"yfinance batch download failed: {e}")
        cache_set(cache_key, result)
        return result

    # ── Extract prices ──
    for key, ticker in tickers_map.items():
        try:
            if len(tickers_map) == 1:
                series = data["Close"]
            else:
                series = data[(ticker, "Close")]
            series = series.dropna()
            if len(series) > 0:
                result["prices"][key] = _safe_float(series.iloc[-1])
        except (KeyError, IndexError):
            pass

    # ── Valuation (SPY as proxy, with fallbacks) ──
    pe = fwd_pe = None
    for etf in ["SPY", "IVV", "VOO"]:
        try:
            info = _timeout_call(lambda e=etf: yf.Ticker(e).info, timeout=15)
            pe = pe or info.get("trailingPE")
            fwd_pe = fwd_pe or info.get("forwardPE")
            if pe and fwd_pe:
                break
        except Exception:
            continue

    result["valuation"] = {
        "pe_trailing": round(pe, 2) if pe else None,
        "pe_forward": round(fwd_pe, 2) if fwd_pe else None,
    }

    # ── Technical: RSI, 200MA ──
    try:
        sp500_hist = _ydl("^GSPC", period="1y", auto_adjust=True, progress=False)
        if "Close" in sp500_hist.columns and len(sp500_hist) > 200:
            closes = sp500_hist["Close"]
            ma_info = _compute_ma_deviation(closes)
            if ma_info:
                result["technical"].update(ma_info)
            rsi = _compute_rsi(closes)
            if rsi:
                result["technical"]["rsi_14"] = round(rsi, 1)
    except Exception as e:
        result["errors"].append(f"technical calc failed: {e}")

    # ── Macro ──
    y10 = result["prices"].get("tnx")
    y2 = result["prices"].get("irx")
    result["macro"] = {
        "yield_10y": y10,
        "yield_short": y2,
        "spread_10y_2y": round(y10 - y2, 3) if y10 and y2 else None,
        "wti_oil": result["prices"].get("oil"),
        "brent_oil": result["prices"].get("brent"),
        "dxy": result["prices"].get("dxy"),
    }

    # ── Market Breadth ──
    sample = 50 if mode == "quick" else 200
    breadth = _compute_breadth(sample_size=sample)
    if breadth:
        result["technical"]["breadth"] = {"pct_above_200ma": breadth}

    # ── Credit ETF Proxies (free alternatives to OAS) ──
    credit_data = _fetch_credit_etfs()
    if credit_data:
        result["credit_etfs"] = credit_data

    # ── Risk Appetite Proxies ──
    risk_data = _fetch_risk_proxies()
    if risk_data:
        result["risk_proxies"] = risk_data

    # ── Commodity ETFs (more reliable than futures) ──
    commodity_data = _fetch_commodity_etfs()
    if commodity_data:
        result["commodities"] = commodity_data

    # ── FX ──
    fx_data = _fetch_fx()
    if fx_data:
        for k, v in fx_data.items():
            result["macro"][k] = v

    # ── Sector Rotation ──
    sector_data = _fetch_sectors()
    if sector_data:
        result["sectors"] = sector_data

    cache_set(cache_key, result)
    return result


def _fetch_risk_proxies() -> Optional[dict]:
    """Fetch BTC, EEM, SOX as risk appetite proxies."""
    proxies = {"btc": "BTC-USD", "eem": "EEM", "sox": "^SOX"}
    result = {}
    for key, ticker in proxies.items():
        try:
            hist = _ydl(ticker, period="1mo", auto_adjust=True, progress=False)
            if "Close" in hist.columns and len(hist) > 5:
                closes = hist["Close"]
                latest = _safe_float(closes.iloc[-1])
                ret_1m = None
                if len(closes) > 21:
                    month_ago = _safe_float(closes.iloc[-22])
                    ret_1m = round((latest - month_ago) / month_ago * 100, 2) if month_ago and month_ago > 0 else None
                result[key] = {"price": latest, "ret_1m_pct": ret_1m}
        except Exception:
            continue
    return result if result else None


def _fetch_credit_etfs() -> Optional[dict]:
    """Fetch HYG, LQD, TLT as free credit/risk proxies."""
    etfs = {"hyg": "HYG", "lqd": "LQD", "tlt": "TLT"}
    result = {}
    for key, ticker in etfs.items():
        try:
            hist = _ydl(ticker, period="6mo", auto_adjust=True, progress=False)
            if "Close" in hist.columns and len(hist) > 50:
                closes = hist["Close"]
                latest = _safe_float(closes.iloc[-1])
                ma50 = _safe_float(closes.rolling(window=50).mean().iloc[-1])
                ma200 = None
                if len(closes) > 200:
                    ma200 = _safe_float(closes.rolling(window=200).mean().iloc[-1])
                # 1-month return
                if len(closes) > 21:
                    month_ago = _safe_float(closes.iloc[-22])
                    ret_1m = round((latest - month_ago) / month_ago * 100, 2) if month_ago and month_ago > 0 else None
                else:
                    ret_1m = None

                result[key] = {
                    "price": latest,
                    "ma50": ma50,
                    "ma200": ma200,
                    "ret_1m_pct": ret_1m,
                    "above_ma50": (latest > ma50) if latest and ma50 else None,
                }
        except Exception:
            continue
    return result if result else None


def _fetch_commodity_etfs() -> Optional[dict]:
    """Fetch GLD, SLV, CPER as commodity price proxies."""
    etfs = {"gld": "GLD", "slv": "SLV", "cper": "CPER"}
    result = {}
    for key, ticker in etfs.items():
        try:
            hist = _ydl(ticker, period="3mo", auto_adjust=True, progress=False)
            if "Close" in hist.columns and len(hist) > 0:
                latest = _safe_float(hist["Close"].iloc[-1])
                if latest:
                    result[key] = latest
        except Exception:
            continue
    return result if result else None


def _fetch_fx() -> Optional[dict]:
    """Fetch EUR/USD and USD/JPY."""
    result = {}
    for key, ticker in [("eurusd", "EURUSD=X"), ("usdjpy", "JPY=X")]:
        try:
            hist = _ydl(ticker, period="5d", auto_adjust=True, progress=False)
            if "Close" in hist.columns and len(hist) > 0:
                val = _safe_float(hist["Close"].iloc[-1])
                if val:
                    result[key] = val
        except Exception:
            continue
    return result if result else None


def _fetch_sectors() -> Optional[dict]:
    """Fetch sector ETF performance for rotation analysis."""
    etfs = {"xlf": "XLF", "xlk": "XLK", "xle": "XLE", "xlu": "XLU"}
    result = {}
    for key, ticker in etfs.items():
        try:
            hist = _ydl(ticker, period="1mo", auto_adjust=True, progress=False)
            if "Close" in hist.columns and len(hist) > 5:
                closes = hist["Close"]
                latest = _safe_float(closes.iloc[-1])
                ret_1m = None
                if len(closes) > 21:
                    month_ago = _safe_float(closes.iloc[-22])
                    ret_1m = round((latest - month_ago) / month_ago * 100, 2) if month_ago and month_ago > 0 else None
                result[key] = {"price": latest, "ret_1m_pct": ret_1m}
        except Exception:
            continue
    return result if result else None


def fetch_tw_market(mode: str = "quick") -> dict[str, Any]:
    """Fetch Taiwan market data."""
    cache_key = f"tw_market_{mode}"
    cached = cache_get(cache_key, TTL_PRICE)
    if cached:
        return cached

    result: dict[str, Any] = {
        "market": "tw",
        "timestamp": datetime.now().isoformat(),
        "prices": {},
        "valuation": {},
        "technical": {},
        "errors": [],
    }

    # ── TW Weighted Index ──
    try:
        twii = _ydl("^TWII", period="1y", auto_adjust=True, progress=False)
        if "Close" in twii.columns and len(twii) > 0:
            closes = twii["Close"]
            result["prices"]["twii"] = _safe_float(closes.iloc[-1])

            if len(closes) > 200:
                ma_info = _compute_ma_deviation(closes)
                if ma_info:
                    result["technical"].update(ma_info)

            rsi = _compute_rsi(closes)
            if rsi:
                result["technical"]["rsi_14"] = round(rsi, 1)

            # Price percentile (52-week range)
            if len(closes) > 252:
                yr_low = _safe_float(closes.iloc[-252:].min())
                yr_high = _safe_float(closes.iloc[-252:].max())
            elif len(closes) > 20:
                yr_low = _safe_float(closes.min())
                yr_high = _safe_float(closes.max())
            else:
                yr_low = yr_high = None
            if yr_low and yr_high and yr_high > yr_low:
                latest = _safe_float(closes.iloc[-1])
                if latest:
                    pct = round((latest - yr_low) / (yr_high - yr_low) * 100, 1)
                    result["technical"]["price_pct_52w"] = pct

            # Volume ratio (current vol / 20-day avg vol)
            if "Volume" in twii.columns:
                volumes = twii["Volume"]
                latest_vol = _safe_float(volumes.iloc[-1])
                if latest_vol and len(volumes) > 20:
                    avg_vol = _safe_float(volumes.iloc[-21:-1].mean())
                    if avg_vol and avg_vol > 0:
                        vol_ratio = round(latest_vol / avg_vol, 2)
                        result["technical"]["volume_ratio"] = vol_ratio
    except Exception as e:
        result["errors"].append(f"TWII fetch failed: {e}")

    # ── Valuation via 0050.TW ──
    try:
        info = _timeout_call(lambda: yf.Ticker("0050.TW").info, timeout=15)
        pe = info.get("trailingPE")
        result["valuation"] = {
            "pe_trailing": round(pe, 2) if pe else None,
            "pe_forward": round(info.get("forwardPE"), 2) if info.get("forwardPE") else None,
        }
    except Exception as e:
        result["errors"].append(f"TW valuation fetch failed: {e}")

    # ── Also fetch 0050.TW price for better MA/RSI ──
    try:
        etf50 = _ydl("0050.TW", period="1y", auto_adjust=True, progress=False)
        if "Close" in etf50.columns and len(etf50) > 0:
            result["prices"]["0050_tw"] = _safe_float(etf50["Close"].iloc[-1])
            if len(etf50) > 200:
                ma_info = _compute_ma_deviation(etf50["Close"])
                if ma_info:
                    result["technical"]["0050_ma200"] = ma_info["ma200"]
                    result["technical"]["0050_deviation_pct"] = ma_info["deviation_pct"]
    except Exception:
        pass

    cache_set(cache_key, result)
    return result


# ═══════════════════════════════════════════════════════════════
# CLI test
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import json as _json
    import sys

    market = sys.argv[1] if len(sys.argv) > 1 else "us"
    mode = sys.argv[2] if len(sys.argv) > 2 else "quick"

    if market == "us":
        data = fetch_us_market(mode)
    elif market == "tw":
        data = fetch_tw_market(mode)
    else:
        print("Usage: fetchers.py [us|tw] [quick|full]")
        sys.exit(1)

    print(_json.dumps(data, indent=2, default=str))