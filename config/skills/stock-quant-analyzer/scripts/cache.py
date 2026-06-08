"""
Simple JSON file cache for stock data.
TTL-based: price data 1hr, slow-moving data 24hr.
"""

import json
import os
import time
from datetime import datetime
from typing import Any, Optional

CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", ".cache", "stock_quant_cache.json")
CACHE_DIR = os.path.dirname(CACHE_FILE)

# TTL in seconds
TTL_PRICE = 3600       # 1 hour for price data
TTL_SLOW = 86400       # 24 hours for CAPE, AAII, etc.
TTL_MEDIUM = 14400     # 4 hours for FedWatch


def _ensure_dir():
    os.makedirs(CACHE_DIR, exist_ok=True)


def _load_cache() -> dict:
    """Load cache from disk."""
    _ensure_dir()
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def _save_cache(cache: dict):
    """Save cache to disk."""
    _ensure_dir()
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2, default=str)


def get(key: str, ttl: int = TTL_PRICE) -> Optional[Any]:
    """Get cached value if not expired."""
    cache = _load_cache()
    if key in cache:
        entry = cache[key]
        age = time.time() - entry.get("_cached_at", 0)
        if age < ttl:
            return entry.get("data")
    return None


def set(key: str, data: Any):
    """Store value in cache."""
    cache = _load_cache()
    cache[key] = {
        "data": data,
        "_cached_at": time.time(),
        "_cached_iso": datetime.now().isoformat(),
    }
    _save_cache(cache)


def invalidate(key: str = None):
    """Remove cached entry. If key is None, clear all."""
    if key is None:
        _ensure_dir()
        if os.path.exists(CACHE_FILE):
            os.remove(CACHE_FILE)
    else:
        cache = _load_cache()
        if key in cache:
            del cache[key]
            _save_cache(cache)


def get_stats() -> dict:
    """Return cache statistics."""
    cache = _load_cache()
    stats = {"entries": len(cache), "keys": []}
    for key, entry in cache.items():
        age_sec = time.time() - entry.get("_cached_at", 0)
        stats["keys"].append({
            "key": key,
            "age_minutes": round(age_sec / 60, 1),
            "cached_at": entry.get("_cached_iso"),
        })
    return stats


# ── CLI ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "stats":
            print(json.dumps(get_stats(), indent=2))
        elif cmd == "clear":
            invalidate()
            print("Cache cleared")
        elif cmd == "get" and len(sys.argv) > 2:
            val = get(sys.argv[2])
            print(json.dumps(val, indent=2, default=str) if val else "null")
        else:
            print("Usage: cache.py [stats|clear|get <key>]")
    else:
        print(json.dumps(get_stats(), indent=2))