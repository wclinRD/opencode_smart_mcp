"""
Free web scrapers for supplementary market data.
All sources are public, no API key required.

Sources:
  - multpl.com      → Shiller CAPE
  - CME FedWatch    → Fed rate hike probability
  - AAII            → Investor sentiment survey
  - CBOE            → Put/Call Ratio (via web scrape, Yahoo ^PCRE delisted)
"""

import json
import os
import re
import time
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ── Circuit Breaker ────────────────────────────────────────────────

CIRCUIT_FILE = os.path.join(os.path.dirname(__file__), ".scraper_circuit.json")
MAX_FAILURES = 3
RESET_HOURS = 1


def _load_circuit() -> dict:
    """Load circuit breaker state from disk."""
    try:
        with open(CIRCUIT_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_circuit(state: dict):
    """Save circuit breaker state to disk."""
    try:
        with open(CIRCUIT_FILE, "w") as f:
            json.dump(state, f)
    except OSError:
        pass


def _circuit_open(name: str) -> bool:
    """Check if circuit breaker is open (skip this scraper)."""
    state = _load_circuit()
    entry = state.get(name, {})
    failures = entry.get("failures", 0)
    last_fail = entry.get("last_fail")
    if failures >= MAX_FAILURES and last_fail:
        elapsed = (datetime.now() - datetime.fromisoformat(last_fail)).total_seconds()
        if elapsed < RESET_HOURS * 3600:
            return True
        # Reset after cooldown
        state.pop(name, None)
        _save_circuit(state)
    return False


def _record_failure(name: str):
    """Record a failure, incrementing the counter."""
    state = _load_circuit()
    entry = state.get(name, {"failures": 0})
    entry["failures"] = entry.get("failures", 0) + 1
    entry["last_fail"] = datetime.now().isoformat()
    state[name] = entry
    _save_circuit(state)


def _record_success(name: str):
    """Reset circuit breaker on success."""
    state = _load_circuit()
    state.pop(name, None)
    _save_circuit(state)

# ── HTTP helpers ─────────────────────────────────────────────────

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

def _fetch(url: str, timeout: int = 10) -> Optional[str]:
    """Fetch URL with retry."""
    for attempt in range(2):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except (URLError, HTTPError, OSError) as e:
            if attempt == 0:
                time.sleep(1)
            else:
                return None
    return None


# ── Shiller CAPE (multpl.com) ────────────────────────────────────

def fetch_cape() -> Optional[dict]:
    """
    Fetch Shiller CAPE ratio from multpl.com.
    Returns: {"cape": float, "timestamp": str} or None
    """
    html = _fetch("https://www.multpl.com/shiller-pe")
    if not html:
        return None

    # The current CAPE value is in a div with specific structure
    # Pattern: <div id="current">...number...</div>
    patterns = [
        r'id="current"[^>]*>\s*([\d,.]+)',
        r'Shiller PE Ratio[^<]*<\s*/\s*[^>]*>\s*<\s*[^>]*>\s*([\d,.]+)',
        r'Current Shiller PE Ratio:\s*([\d,.]+)',
    ]

    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                cape = float(m.group(1).replace(",", ""))
                if 5 < cape < 200:  # sanity check
                    return {"cape": cape, "timestamp": datetime.now().isoformat()}
            except ValueError:
                continue

    # Fallback: try to find any number near "Shiller"
    m = re.search(r'Shiller[^<]*<[^>]*>[^<]*<[^>]*>\s*([\d,.]+)', html, re.IGNORECASE)
    if m:
        try:
            cape = float(m.group(1).replace(",", ""))
            if 5 < cape < 200:
                return {"cape": cape, "timestamp": datetime.now().isoformat()}
        except ValueError:
            pass

    return None


# ── CME FedWatch ─────────────────────────────────────────────────

def fetch_fedwatch() -> Optional[dict]:
    """
    Fetch Fed rate hike probability.
    Primary: CME FedWatch JSON API (no auth needed).
    Fallback: scraping the HTML page.
    Returns: {"hike_prob": float, "current_rate": str, "next_meeting": str} or None
    """
    result: dict = {}

    # ── Method 1: CME JSON API ──
    try:
        api_url = "https://www.cmegroup.com/CmeWS/mvc/InterestRates/FedWatch/2026/06/latest"
        req = Request(api_url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        with urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            # The API returns JSONP-like or JSON
            data = json.loads(raw)
            # Navigate to find probabilities
            if isinstance(data, dict):
                # Try common paths
                for key in ["probabilities", "probability", "rateHikeProbability"]:
                    if key in data:
                        result["hike_prob"] = float(data[key])
                        break
                if "hike_prob" not in result:
                    # Search recursively for probability values
                    def _find_prob(obj, depth=0):
                        if depth > 5:
                            return None
                        if isinstance(obj, dict):
                            for k, v in obj.items():
                                if "prob" in str(k).lower() and isinstance(v, (int, float)):
                                    return float(v)
                                r = _find_prob(v, depth + 1)
                                if r:
                                    return r
                        elif isinstance(obj, list):
                            for item in obj[:5]:
                                r = _find_prob(item, depth + 1)
                                if r:
                                    return r
                        return None
                    prob = _find_prob(data)
                    if prob:
                        result["hike_prob"] = prob
    except Exception:
        pass

    # ── Method 2: Scrape HTML ──
    if "hike_prob" not in result:
        html = _fetch("https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html")
        if html:
            # Look for probability percentages in the page
            prob_patterns = [
                r'(\d+\.?\d*)%\s*probability.*?rate\s*hike',
                r'rate\s*hike.*?(\d+\.?\d*)%',
                r'(\d+\.?\d*)%\s*chance.*?hike',
                r'probability.*?"\s*:\s*(\d+\.?\d*)',
            ]
            for pat in prob_patterns:
                m = re.search(pat, html, re.IGNORECASE)
                if m:
                    result["hike_prob"] = float(m.group(1))
                    break

    # Extract next meeting date
    if "next_meeting" not in result:
        html = html if 'html' in dir() else _fetch("https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html")
        if html:
            date_pattern = r'(Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*2026'
            m = re.search(date_pattern, html)
            if m:
                result["next_meeting"] = m.group(0)

    if result:
        result["timestamp"] = datetime.now().isoformat()
        return result
    return None


# ── AAII Sentiment Survey ────────────────────────────────────────

def fetch_aaii() -> Optional[dict]:
    """
    Fetch AAII investor sentiment survey.
    Returns: {"bullish": float, "bearish": float, "neutral": float, "week": str} or None
    """
    html = _fetch("https://www.aaii.com/sentimentsurvey")
    if not html:
        return None

    result: dict = {}

    # AAII page has sentiment numbers in specific elements
    # Look for percentage patterns near "Bullish", "Bearish", "Neutral"
    patterns = {
        "bullish": [
            r'Bullish[^<]*<\s*/\s*[^>]*>\s*<\s*[^>]*>\s*([\d.]+)%',
            r'bullish[:\s]*([\d.]+)%',
        ],
        "bearish": [
            r'Bearish[^<]*<\s*/\s*[^>]*>\s*<\s*[^>]*>\s*([\d.]+)%',
            r'bearish[:\s]*([\d.]+)%',
        ],
        "neutral": [
            r'Neutral[^<]*<\s*/\s*[^>]*>\s*<\s*[^>]*>\s*([\d.]+)%',
            r'neutral[:\s]*([\d.]+)%',
        ],
    }

    for key, pats in patterns.items():
        for pat in pats:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                result[key] = float(m.group(1))
                break

    # Try to find the survey week
    week_pattern = r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*2026'
    m = re.search(week_pattern, html)
    if m:
        result["week"] = m.group(0)

    if len(result) >= 3:  # at least bullish, bearish, neutral
        result["timestamp"] = datetime.now().isoformat()
        return result
    return None


# ── CBOE Put/Call Ratio (via Yahoo Finance ^PCRE) ────────────────

def fetch_put_call_ratio() -> Optional[dict]:
    """
    Fetch CBOE Total Put/Call Ratio.
    Sources: convextrade.com — static HTML, no JS required.
    Returns: {"pcr": float, "timestamp": str} or None
    """
    try:
        html = _fetch("https://convextrade.com/metrics/put-call-ratio", timeout=15)
        if not html:
            return None

        # Method 1: Extract from page heading (most reliable)
        m = re.search(r'Put/Call Ratio[:\s]*([\d.]+)', html)
        if m:
            pcr = float(m.group(1))
            if 0.1 < pcr < 5.0:
                return {"pcr": round(pcr, 2), "source": "convextrade.com", "timestamp": datetime.now().isoformat()}

        # Method 2: Extract from table (PCR values are at odd indices)
        raw_values = re.findall(r'>([\d.]+)</td>', html)
        pcr_values = []
        for i, v in enumerate(raw_values):
            try:
                fv = float(v)
                if 0.1 < fv < 5.0:
                    # Skip every other value (change %)
                    if i == 0 or float(raw_values[i-1]) > 5.0 or float(raw_values[i-1]) < 0.1:
                        pcr_values.append(fv)
            except (ValueError, IndexError):
                pass

        if pcr_values:
            pcr = pcr_values[0]  # First matching value = most recent
            return {"pcr": round(pcr, 2), "source": "convextrade.com", "timestamp": datetime.now().isoformat()}
    except Exception:
        pass

    return None


# ── Cleveland Fed Recession Probability ──────────────────────────

RECESSION_PROB_URL = "https://www.clevelandfed.org/indicators-and-data/yield-curve-and-predicted-gdp-growth"

def fetch_recession_prob() -> Optional[float]:
    """
    Fetch 12-month recession probability from Cleveland Fed.
    Returns: probability (0-100) or None
    """
    html = _fetch(RECESSION_PROB_URL, timeout=15)
    if not html:
        return None
    # Table row: <tr><th ...>Probability of recession in 1 year (percent)</th><td>12.5</td>...
    m = re.search(r'Probability of recession.*?</th>\s*<td>([\d.]+)</td>', html, re.IGNORECASE)
    if m:
        try:
            prob = float(m.group(1))
            if 0 <= prob <= 100:
                return prob
        except ValueError:
            pass
    return None


# ── S&P 500 Forward P/E Ratio ─────────────────────────────────

FWD_PE_URL = "https://vcpscanner.com/market-valuation"

def fetch_fwd_pe() -> Optional[dict]:
    """
    Scrape S&P 500 forward P/E from vcpscanner.com.
    Returns: {"fwd_pe": float, "pe": float|None, "mkt_cap_t": float|None, "timestamp": str}
    """
    try:
        html = _fetch(FWD_PE_URL, timeout=15)
        if not html:
            return None
        result: dict[str, Any] = {}
        # Forward P/E — appears in <!-- --> comments
        m_fwd = re.search(r'forward P/E of\s*<!--\s*-->([\d.]+)', html, re.IGNORECASE)
        if m_fwd:
            result["fwd_pe"] = float(m_fwd.group(1))
        # Trailing P/E
        m_pe = re.search(r'P/E ratio is\s*<!--\s*-->([\d.]+)', html, re.IGNORECASE)
        if m_pe:
            result["pe"] = float(m_pe.group(1))
        # Market cap — extract from S&P 500 table row: ...<td>$71.0T</td>...
        m_mcap = re.search(r'<td>\$([\d.]+)T</td>\s*<td>502</td>', html)
        if m_mcap:
            cap = float(m_mcap.group(1))
            if 10 < cap < 200:
                result["mkt_cap_t"] = cap
        if not result:
            return None
        result["timestamp"] = datetime.now().isoformat()
        return result
    except Exception:
        return None


# ── Market Cap / GDP (Buffett Indicator proxy) ──────────────────

def fetch_mkt_gdp() -> Optional[float]:
    """
    Fetch US total stock market cap / GDP ratio.
    Uses S&P 500 market cap from vcpscanner.com + US GDP estimate.
    Returns ratio as percentage (e.g., 237 = 237%).
    """
    fwd_data = fetch_fwd_pe()
    mkt_cap_t = fwd_data.get("mkt_cap_t") if fwd_data else None
    if not mkt_cap_t:
        return None
    # US nominal GDP ~ $30.5T (2026 estimate)
    GDP_TRILLION = 30.5
    ratio = (mkt_cap_t / GDP_TRILLION) * 100
    return round(ratio, 1)


# ── Bulk fetch ───────────────────────────────────────────────────

def fetch_all_scrapers() -> dict[str, Any]:
    """Run all scrapers and return combined results."""
    results: dict[str, Any] = {
        "cape": None,
        "fedwatch": None,
        "aaii": None,
        "put_call": None,
        "recession_prob": None,
        "mkt_gdp": None,
        "fwd_pe": None,
        "errors": [],
    }

    scrapers = [
        ("cape", fetch_cape),
        ("fedwatch", fetch_fedwatch),
        ("aaii", fetch_aaii),
        ("put_call", fetch_put_call_ratio),
        ("recession_prob", fetch_recession_prob),
        ("mkt_gdp", fetch_mkt_gdp),
        ("fwd_pe", fetch_fwd_pe),
    ]

    for name, func in scrapers:
        if _circuit_open(name):
            results["errors"].append(f"{name}: circuit breaker open (skipped)")
            continue
        try:
            data = func()
            if data:
                results[name] = data
                _record_success(name)
            else:
                results["errors"].append(f"{name}: no data returned")
                _record_failure(name)
        except Exception as e:
            results["errors"].append(f"{name}: {e}")
            _record_failure(name)

    results["timestamp"] = datetime.now().isoformat()
    return results


# ── CLI test ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        target = sys.argv[1]
        funcs = {
            "cape": fetch_cape,
            "fedwatch": fetch_fedwatch,
            "aaii": fetch_aaii,
            "put_call": fetch_put_call_ratio,
            "recession_prob": lambda: {"recession_prob": fetch_recession_prob()},
            "mkt_gdp": lambda: {"mkt_gdp": fetch_mkt_gdp()},
            "fwd_pe": lambda: {"fwd_pe": fetch_fwd_pe()},
        }
        if target in funcs:
            result = funcs[target]()
            print(json.dumps(result, indent=2, default=str))
        elif target == "all":
            result = fetch_all_scrapers()
            print(json.dumps(result, indent=2, default=str))
        else:
            print(f"Unknown target: {target}. Options: cape, fedwatch, aaii, put_call, recession_prob, mkt_gdp, fwd_pe, all")
    else:
        result = fetch_all_scrapers()
        print(json.dumps(result, indent=2, default=str))