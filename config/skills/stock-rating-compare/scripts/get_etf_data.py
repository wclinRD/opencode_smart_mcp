#!/usr/bin/env python3
"""
Fetch ETF constituent list with current prices from etfinfo.tw.

Usage:
    python3 get_etf_data.py 0050
    python3 get_etf_data.py 0056
    python3 get_etf_data.py 006208

Output: JSON with {code, name, weight, price, change, changePercent}
"""

import json
import re
import sys
import urllib.request

ETFINFO_URL = "https://www.etfinfo.tw/etf/{}/holdings"


def fetch_page(etf_code: str) -> str:
    url = ETFINFO_URL.format(etf_code)
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/120.0.0.0 Safari/537.36"
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_nuxt_data(html: str) -> list:
    """Extract the __NUXT_DATA__ JSON blob from the page."""
    match = re.search(
        r'<script[^>]+id="__NUXT_DATA__"[^>]*>(.*?)</script>',
        html, re.DOTALL
    )
    if not match:
        raise ValueError("Cannot find __NUXT_DATA__ in page")
    return json.loads(match.group(1))


def resolve(data: list, idx):
    """Resolve a value that may be an index reference in the serialized data."""
    if isinstance(idx, int) and 0 <= idx < len(data):
        return data[idx]
    return idx


def extract_holdings(data: list) -> list:
    """Extract stock holdings with prices from the Nuxt serialized data."""
    total = len(data)

    # Find all dict entries with stock holding pattern
    holdings = []
    for i in range(total):
        item = data[i]
        if (isinstance(item, dict)
                and "code" in item
                and "name" in item
                and "weight" in item
                and "shares" in item):
            code = resolve(data, item["code"])
            name = resolve(data, item["name"])
            weight = resolve(data, item["weight"])
            # Filter: only 4-digit stock codes (skip futures like TX, NYF)
            if isinstance(code, str) and code.isdigit() and len(code) == 4:
                holdings.append({
                    "code": code,
                    "name": name,
                    "weight": weight,
                })

    # Find price entries
    price_map = {}  # code -> {price, change, changePercent}
    for i in range(total):
        item = data[i]
        if (isinstance(item, dict)
                and "code" in item
                and "price" in item
                and "change" in item):
            code = resolve(data, item["code"])
            price = resolve(data, item.get("price"))
            change = resolve(data, item.get("change"))
            change_pct = resolve(data, item.get("changePercent"))
            volume = resolve(data, item.get("volume"))
            if isinstance(code, str) and code.isdigit():
                price_map[code] = {
                    "price": price,
                    "change": change,
                    "changePercent": change_pct,
                    "volume": volume,
                }

    # Deduplicate by code (Nuxt data has two groups with same codes)
    seen = set()
    unique_holdings = []
    for h in holdings:
        if h["code"] not in seen:
            seen.add(h["code"])
            unique_holdings.append(h)

    # Merge prices into holdings
    for h in unique_holdings:
        code = h["code"]
        if code in price_map:
            h.update(price_map[code])

    return unique_holdings


def main():
    etf_code = sys.argv[1] if len(sys.argv) > 1 else "0050"
    print(f"Fetching {etf_code} constituents...", file=sys.stderr)

    html = fetch_page(etf_code)
    nuxt_data = extract_nuxt_data(html)
    holdings = extract_holdings(nuxt_data)

    print(json.dumps(holdings, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
