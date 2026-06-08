"""
History tracking for quantitative reports.
Stores previous composite scores for trend comparison.
"""

import json
import os
from datetime import datetime
from typing import Any, Optional

HISTORY_FILE = os.path.join(os.path.dirname(__file__), "..", ".cache", "score_history.json")
HISTORY_DIR = os.path.dirname(HISTORY_FILE)


def _ensure_dir():
    os.makedirs(HISTORY_DIR, exist_ok=True)


def save(market: str, composite: float, dimensions: dict, timestamp: str = None):
    """Save a score snapshot to history."""
    _ensure_dir()
    history = _load()
    if market not in history:
        history[market] = []

    entry = {
        "timestamp": timestamp or datetime.now().isoformat(),
        "composite": composite,
        "dimensions": {
            k: v["avg_score"]
            for k, v in dimensions.items()
            if k not in ("composite", "risk")
        },
        "risk_level": dimensions.get("risk", {}).get("level", "unknown"),
    }
    history[market].append(entry)

    # Keep last 52 entries (1 year of weekly data)
    if len(history[market]) > 52:
        history[market] = history[market][-52:]

    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2, default=str)


def _load() -> dict:
    """Load history from disk."""
    _ensure_dir()
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def get_previous(market: str) -> Optional[dict]:
    """Get the most recent previous entry for comparison."""
    history = _load()
    entries = history.get(market, [])
    if len(entries) >= 2:
        return entries[-2]  # second-to-last
    return None


def get_trend(market: str, weeks: int = 4) -> list[dict]:
    """Get last N weeks of scores for trend analysis."""
    history = _load()
    entries = history.get(market, [])
    return entries[-weeks:] if len(entries) >= weeks else entries


def compare(current: dict, previous: Optional[dict]) -> dict:
    """Generate comparison between current and previous scores."""
    if not previous:
        return {"available": False}

    comp = {"available": True, "changes": {}}

    curr_comp = current.get("composite", 0)
    prev_comp = previous.get("composite", 0)
    delta = round(curr_comp - prev_comp, 1)

    if delta > 5:
        comp["direction"] = "↑ 顯著改善"
    elif delta > 1:
        comp["direction"] = "↗ 小幅改善"
    elif delta > -1:
        comp["direction"] = "→ 持平"
    elif delta > -5:
        comp["direction"] = "↘ 小幅惡化"
    else:
        comp["direction"] = "↓ 顯著惡化"

    comp["composite_delta"] = delta
    comp["previous_composite"] = prev_comp
    comp["previous_date"] = previous.get("timestamp", "")[:10]

    # Per-dimension deltas
    curr_dims = {
        k: v["avg_score"]
        for k, v in current.items()
        if isinstance(v, dict) and "avg_score" in v
    }
    prev_dims = previous.get("dimensions", {})
    for dim in curr_dims:
        if dim in prev_dims:
            d = round(curr_dims[dim] - prev_dims[dim], 1)
            comp["changes"][dim] = d

    return comp


def get_all(market: str) -> list[dict]:
    """Get all history entries for a market."""
    history = _load()
    return history.get(market, [])


def clear(market: str = None):
    """Clear history for a market or all."""
    if market:
        history = _load()
        if market in history:
            del history[market]
            with open(HISTORY_FILE, "w") as f:
                json.dump(history, f, indent=2)
    else:
        _ensure_dir()
        if os.path.exists(HISTORY_FILE):
            os.remove(HISTORY_FILE)


# ── CLI ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "list":
            market = sys.argv[2] if len(sys.argv) > 2 else "us"
            entries = get_all(market)
            for e in entries:
                print(f"{e['timestamp'][:10]} | {e['composite']:5.1f} | {e['risk_level']}")
        elif cmd == "clear":
            market = sys.argv[2] if len(sys.argv) > 2 else None
            clear(market)
            print("History cleared")
        else:
            print("Usage: history.py [list|clear] [market]")
    else:
        for mkt in ["us", "tw"]:
            entries = get_all(mkt)
            if entries:
                print(f"\n{mkt}:")
                for e in entries[-5:]:
                    print(f"  {e['timestamp'][:10]} | {e['composite']:5.1f} | {e['risk_level']}")