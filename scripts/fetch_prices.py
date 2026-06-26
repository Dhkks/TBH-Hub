#!/usr/bin/env python3
"""
TBH Hub - Steam Market Price Fetcher
Fetches all TBH item prices from Steam Market in USD (the only currency
reliably returned by the bulk search/render endpoint).
The app converts to local currency for display using exchange rates.
"""

import json
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone

APPID = 3678970
BATCH_SIZE = 100
DELAY_BETWEEN_BATCHES = 8

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_batch(start: int) -> tuple[list, int]:
    """Fetch one page of market listings. Returns (results, total_count)."""
    url = (
        f"https://steamcommunity.com/market/search/render/"
        f"?appid={APPID}&norender=1"
        f"&count={BATCH_SIZE}&start={start}"
        f"&currency=1&language=english"
    )
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            if r.status == 429:
                print(f"  429 at start={start}, waiting 30s...")
                time.sleep(30)
                return fetch_batch(start)
            data = json.loads(r.read().decode())
            return data.get("results", []), data.get("total_count", 0)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print(f"  429 at start={start}, waiting 30s...")
            time.sleep(30)
            return fetch_batch(start)
        return [], 0
    except Exception as e:
        print(f"  Error at start={start}: {e}")
        return [], 0


def main():
    print(f"TBH Hub Price Fetcher — {datetime.now(timezone.utc).isoformat()}")
    
    prices = {}
    start = 0
    total_count = None

    while True:
        batch, count = fetch_batch(start)
        if total_count is None:
            total_count = count
            print(f"Total items on market: {total_count}")
        
        if not batch:
            break

        for item in batch:
            name = item.get("hash_name", "")
            if not name:
                continue
            prices[name] = {
                "sell": item.get("sell_price", 0),
                "sell_text": item.get("sell_price_text", ""),
                "listings": item.get("sell_listings", 0),
            }

        print(f"  batch start={start}: {len(batch)} items (total fetched: {len(prices)})")

        if start + BATCH_SIZE >= total_count or len(batch) < BATCH_SIZE:
            break

        start += BATCH_SIZE
        time.sleep(DELAY_BETWEEN_BATCHES)

    # Fetch USD/BRL exchange rate from a free public API
    exchange_rates = {}
    try:
        rate_req = urllib.request.Request(
            "https://open.er-api.com/v6/latest/USD",
            headers={"User-Agent": "curl/7.68.0"}
        )
        with urllib.request.urlopen(rate_req, timeout=10) as r:
            rate_data = json.loads(r.read())
            rates = rate_data.get("rates", {})
            exchange_rates = {
                "BRL": rates.get("BRL"),
                "EUR": rates.get("EUR"),
                "GBP": rates.get("GBP"),
            }
            print(f"Exchange rates (USD base): {exchange_rates}")
    except Exception as e:
        print(f"  Could not fetch exchange rates: {e}")

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "appid": APPID,
        "currency": "USD",
        "exchange_rates": exchange_rates,
        "prices": prices,
    }

    with open("prices.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nDone! {len(prices)} items written to prices.json")


if __name__ == "__main__":
    main()
