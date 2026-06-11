# Academic API Query Patterns (Crossref & OpenAlex)

During Phase 4.5 (Anti-Hallucination), use these specific patterns to verify DOIs and retrieve metadata.

## 1. Crossref DOI Liveness Check (Terminal/Curl)
The fastest way to manually verify if a DOI exists is a silent HTTP HEAD request to the Crossref API.

> **⚠️ WARNING:** This `curl` example is for **manual/one-off testing only**.
> For automated DOI verification in the pipeline, use Python `requests.get()` as instructed in SKILL.md Phase 4.5.
> Never pass unsanitized DOIs/URLs to `curl` in automated code — doing so creates a command injection risk.

```bash
# Returns HTTP 200 OK for real DOIs, HTTP 404 for hallucinations
curl -I -s https://api.crossref.org/works/10.1016/j.jclepro.2024.140123 | grep HTTP
```

## 2. OpenAlex Database Search (Python)
When searching OpenAlex for semantic matches (e.g., CBAM + AHP), use `urllib` but **beware of control character errors**. 

**PITFALL:** `urllib.request.urlopen` will throw `URL can't contain control characters` if the query contains spaces or quotes. You MUST use `urllib.parse.quote()` for the search string.

```python
import urllib.request
import urllib.parse
import json
import ssl
import time

ctx = ssl.create_default_context()  # Uses system CA bundle for proper SSL verification

# CORRECT: Quote the query string
query = '"Carbon Border Adjustment Mechanism" AHP MCDA'
url = 'https://api.openalex.org/works?search=' + urllib.parse.quote(query) + '&per-page=10'

req = urllib.request.Request(url, headers={'User-Agent': 'mailto:your.email@example.com'})
with urllib.request.urlopen(req, context=ctx) as response:
    data = json.loads(response.read().decode())
    for w in data.get('results', []):
        print(f"{w.get('title')} | DOI: {w.get('doi')}")


## 3. Pagination Template with Rate-Limit Backoff

When fetching more than one page of results (e.g., OpenAlex or Crossref), use this
pattern to respect API rate limits and avoid unbounded requests:

```python
def fetch_all_paginated(base_url, max_pages=10, per_page=50):
    """
    Fetch paginated results from OpenAlex/Crossref API.
    - Respects rate limits with 1-second delay between pages.
    - Stops at max_pages to prevent runaway requests.
    - Returns concatenated list of results.
    """
    import urllib.request, urllib.parse, json, time
    
    ctx = ssl.create_default_context()
    cursor = "*"
    all_results = []
    page = 0
    
    while cursor and page < max_pages:
        sep = "&" if "?" in base_url else "?"
        url = f"{base_url}{sep}per-page={per_page}&cursor={urllib.parse.quote(cursor)}"
        
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'mailto:your.email@example.com'}
        )
        
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"[RATE LIMITED] Retrying after 5s (page {page+1})...")
                time.sleep(5)
                continue
            elif e.code == 403:
                print(f"[FORBIDDEN] Access denied at page {page+1}")
                break
            else:
                raise
        except urllib.error.URLError as e:
            print(f"[NETWORK ERROR] {e.reason} at page {page+1}")
            break
        
        results = data.get('results', [])
        all_results.extend(results)
        cursor = data.get('meta', {}).get('next_cursor')
        page += 1
        
        # Rate-limit backoff: 1 second between requests
        if cursor:
            time.sleep(1)
    
    if page == max_pages and cursor:
        print(f"[WARN] Reached max_pages={max_pages}; results may be incomplete.")
    
    return all_results
```

**Usage:**
```python
base = 'https://api.openalex.org/works?search=' + urllib.parse.quote(query)
papers = fetch_all_paginated(base, max_pages=5, per_page=50)
print(f"Fetched {len(papers)} papers total")
```