#!/usr/bin/env python3
"""
Search 鉅亨網 外資評等 for target price changes, filtered by stock codes.

Usage:
    python3 search_cnyes_ratings.py --codes 2330,2454,2308
    python3 search_cnyes_ratings.py --codes 2330,2308 --pages 5
    python3 search_cnyes_ratings.py --codes-file stocks.json

Output: JSON list of {code, name, broker, action, target_price, old_target, date, source}
"""

import json
import re
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

CNYES_URL = "https://www.cnyes.com/twstock/board/ratediff.aspx"

# Known stock names for stocks that appear in 0050
# Used as fallback when name extraction fails
COMMON_STOCKS = {
    "2330": "台積電", "2454": "聯發科", "2308": "台達電", "2317": "鴻海",
    "3711": "日月光投控", "2303": "聯電", "2383": "台光電", "2327": "國巨",
    "3037": "欣興", "2345": "智邦", "2891": "中信金", "2382": "廣達",
    "2881": "富邦金", "2360": "致茂", "3017": "奇鋐", "2882": "國泰金",
    "2885": "元大金", "2357": "華碩", "2887": "台新新光金", "3231": "緯創",
    "2344": "華邦電", "6669": "緯穎", "1303": "南亞", "2412": "中華電",
    "2886": "兆豐金", "2884": "玉山金", "2408": "南亞科", "2301": "光寶科",
    "2368": "金像電", "2890": "永豐金", "2883": "凱基金", "3008": "大立光",
    "3661": "世芯-KY", "1216": "統一", "2449": "京元電子", "3653": "健策",
    "2880": "華南金", "2892": "第一金", "2059": "川湖", "2603": "長榮",
    "2395": "研華", "1301": "台塑", "2002": "中鋼", "4904": "遠傳",
    "3045": "台灣大", "2207": "和泰車", "6505": "台塑化",
}


def fetch_page(page: int = 1) -> str:
    """Fetch one page of 鉅亨網 外資評等."""
    params = urllib.parse.urlencode({"page": page})
    url = f"{CNYES_URL}?{params}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36",
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_ratings_table(html: str) -> list:
    """
    Parse the ratings table from 鉅亨網 page.
    The page contains a complex table with stock ratings data.
    """
    results = []

    # Look for table rows containing stock data
    # Pattern: stock code links like /twstock/2330
    stock_links = re.findall(
        r'/twstock/(\d{4})[^"]*"[^>]*>([^<]+)</a>',
        html
    )

    # Try to find structured data in the page
    # Look for script tags with data
    scripts = re.findall(r'<script[^>]*>([^<]+)</script>', html)

    # Try to find table rows with ratings data — case-insensitive
    rows = re.findall(
        r'<tr[^>]*>(.*?)</tr>',
        html, re.DOTALL | re.IGNORECASE
    )

    # Alternative: search for date patterns near stock codes
    # Dates like 20260605 (YYYYMMDD in page) or 2026/05/22
    date_pattern = r'(\d{8})'

    for row in rows:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL | re.IGNORECASE)
        if len(cells) >= 4:
            row_text = re.sub(r'<[^>]+>', ' ', row).strip()
            row_text = re.sub(r'\s+', ' ', row_text)

            # Check for stock code in this row
            code_match = re.search(r'/(\d{4})', row)
            if code_match:
                code = code_match.group(1)
                # Cells: [0]=date, [1]=stock, [2]=source, [5]=rating, [6]=old_target?, [7]=current_price?, [8]=target?
                date_raw = re.sub(r'<[^>]+>', '', cells[0]).strip()
                name_raw = re.sub(r'<[^>]+>', '', cells[1]).strip() if len(cells) > 1 else ''
                source_raw = re.sub(r'<[^>]+>', '', cells[2]).strip() if len(cells) > 2 else ''
                rating_raw = re.sub(r'<[^>]+>', '', cells[5]).strip() if len(cells) > 5 else ''
                
                # Extract prices: look for numbers in cells 6,7,8
                prices = []
                for ci in [6, 7, 8]:
                    if ci < len(cells):
                        p_text = re.sub(r'<[^>]+>', '', cells[ci]).strip()
                        try:
                            if p_text:
                                prices.append(float(p_text))
                            else:
                                prices.append(None)
                        except ValueError:
                            prices.append(None)

                results.append({
                    "code": code,
                    "name": name_raw.replace(f'{code}-', '') if '-' in name_raw else name_raw,
                    "date": date_raw,
                    "source": source_raw,
                    "rating": rating_raw,
                    "price_old": prices[0] if len(prices) > 0 else None,
                    "price_current": prices[1] if len(prices) > 1 else None,
                    "price_target": prices[2] if len(prices) > 2 else None,
                })

    return results


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Search 鉅亨網 for stock ratings data"
    )
    parser.add_argument("--codes", help="Comma-separated stock codes to filter")
    parser.add_argument("--codes-file", help="JSON file with stocks array")
    parser.add_argument("--pages", type=int, default=5,
                        help="Number of pages to search (default: 5)")
    args = parser.parse_args()

    # Determine target codes
    target_codes = set()
    if args.codes:
        target_codes = set(c.strip() for c in args.codes.split(","))
    if args.codes_file:
        with open(args.codes_file) as f:
            data = json.load(f)
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "code" in item:
                        target_codes.add(item["code"])
                    elif isinstance(item, str):
                        target_codes.add(item)

    print(f"Searching {args.pages} pages for {len(target_codes)} target codes...",
          file=sys.stderr)

    all_results = []
    for page in range(1, args.pages + 1):
        print(f"  Page {page}...", file=sys.stderr)
        try:
            html = fetch_page(page)
            page_results = parse_ratings_table(html)

            # Filter by target codes
            for r in page_results:
                if r["code"] in target_codes:
                    r["page"] = page
                    all_results.append(r)

            # Small delay
            import time
            time.sleep(0.5)
        except Exception as e:
            print(f"  Error on page {page}: {e}", file=sys.stderr)

    print(f"Found {len(all_results)} matching entries", file=sys.stderr)
    print(json.dumps(all_results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
