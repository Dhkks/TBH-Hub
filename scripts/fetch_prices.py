#!/usr/bin/env python3
"""
TBH Hub - Steam Market Price Fetcher
Runs via GitHub Actions every 2h, publishes prices.json to the repo.
The Electron app reads this file instead of calling Steam directly,
avoiding rate limits and making inventory valuation instantaneous.
"""

import json
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone

APPID = 3678970
BATCH_SIZE = 100
DELAY_BETWEEN_BATCHES = 8  # seconds — conservative to avoid 429

# All currencies to fetch. The app picks the right one based on user region.
# Codes: 1=USD, 7=BRL, 3=EUR, 2=GBP
CURRENCIES = {
    "USD": 1,
    "BRL": 7,
    "EUR": 3,
    "GBP": 2,
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_batch(start: int, currency_code: int) -> list[dict]:
    """Fetch one page of market listings."""
    url = (
        f"https://steamcommunity.com/market/search/render/"
        f"?appid={APPID}&norender=1"
        f"&count={BATCH_SIZE}&start={start}"
        f"&currency={currency_code}&language=english"
    )
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            if r.status == 429:
                print(f"  429 rate limited at start={start}, waiting 30s...")
                time.sleep(30)
                return fetch_batch(start, currency_code)  # retry once
            data = json.loads(r.read().decode())
            return data.get("results", [])
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print(f"  429 at start={start}, waiting 30s...")
            time.sleep(30)
            return fetch_batch(start, currency_code)
        print(f"  HTTP error {e.code} at start={start}")
        return []
    except Exception as e:
        print(f"  Error at start={start}: {e}")
        return []


def fetch_all_prices(currency_code: int) -> dict[str, dict]:
    """Fetch all tradable items for a given currency. Returns {hash_name: {sell, median}}."""
    prices = {}
    start = 0
    total_fetched = 0

    print(f"  Fetching currency={currency_code}...")
    while True:
        batch = fetch_batch(start, currency_code)
        if not batch:
            break

        for item in batch:
            name = item.get("hash_name", "")
            if not name:
                continue
            prices[name] = {
                "sell": item.get("sell_price", 0),          # cents
                "sell_text": item.get("sell_price_text", ""),
                "listings": item.get("sell_listings", 0),
            }

        total_fetched += len(batch)
        print(f"    batch start={start}: {len(batch)} items (total: {total_fetched})")

        if len(batch) < BATCH_SIZE:
            break  # last page

        start += BATCH_SIZE
        time.sleep(DELAY_BETWEEN_BATCHES)

    return prices


def main():
    print(f"TBH Hub Price Fetcher — {datetime.now(timezone.utc).isoformat()}")
    print(f"Fetching {len(CURRENCIES)} currencies from Steam Market (appid={APPID})...")

    all_prices = {}  # { currency_code: { hash_name: {...} } }

    for currency_name, currency_code in CURRENCIES.items():
        print(f"\n[{currency_name}]")
        prices = fetch_all_prices(currency_code)
        all_prices[str(currency_code)] = prices
        print(f"  Done: {len(prices)} items")

        # Pause between currencies to be respectful to Steam
        if currency_code != list(CURRENCIES.values())[-1]:
            print(f"  Waiting {DELAY_BETWEEN_BATCHES * 2}s before next currency...")
            time.sleep(DELAY_BETWEEN_BATCHES * 2)

    # Build the output JSON
    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "appid": APPID,
        "currencies": list(CURRENCIES.keys()),
        "prices": all_prices,
    }

    with open("prices.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    total_items = len(all_prices.get("1", {}))
    print(f"\nDone! {total_items} items written to prices.json")
    print(f"Updated at: {output['updated_at']}")


if __name__ == "__main__":
    main()
