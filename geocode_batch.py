"""Geocode a slice of the companies in companies.json that don't yet have
lat/long, writing results incrementally into geocode_cache.json so this can
be run in small batches (avoids long-running single calls).

Usage: python3 geocode_batch.py START END
"""
import json
import os
import sys
import time

import requests

COMPANIES_JSON = "companies.json"
CACHE_PATH = "geocode_cache.json"
CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


def geocode_census(address):
    resp = requests.get(
        CENSUS_URL,
        params={"address": address, "benchmark": "2020", "format": "json"},
        timeout=10,
    )
    resp.raise_for_status()
    matches = resp.json()["result"]["addressMatches"]
    if not matches:
        return None
    coords = matches[0]["coordinates"]
    return coords["x"], coords["y"]


def geocode_nominatim(address):
    resp = requests.get(
        NOMINATIM_URL,
        params={"q": address, "format": "json", "limit": 1},
        headers={"User-Agent": "sdev-mapping-website-geocoder"},
        timeout=10,
    )
    resp.raise_for_status()
    results = resp.json()
    if not results:
        return None
    return float(results[0]["lon"]), float(results[0]["lat"])


def main():
    start = int(sys.argv[1])
    end = int(sys.argv[2])

    with open(COMPANIES_JSON) as f:
        companies = json.load(f)

    cache = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH) as f:
            cache = json.load(f)

    todo = [c for c in companies if c.get("latitude") is None and c["company"] not in cache][start:end]
    print(f"Batch covers {len(todo)} companies (slice [{start}:{end}] of remaining ungeocoded list)")

    for rec in todo:
        company = rec["company"]
        address = rec.get("full_address")
        if not address or address == "NOT FOUND":
            cache[company] = None
        else:
            lonlat = None
            source = None
            try:
                lonlat = geocode_census(address)
                source = "Census"
            except requests.RequestException as e:
                print(f"Census error for {company!r}: {e}")

            if lonlat is None:
                print(f"CENSUS-MISS (will try nominatim later): {company!r} ({address!r})")
                cache[company] = {"needs_nominatim": True, "address": address}
            else:
                print(f"OK ({source}): {company!r} -> {lonlat}")
                cache[company] = {"lon": lonlat[0], "lat": lonlat[1], "source": source}

        # save after every single record so a timeout never loses progress
        with open(CACHE_PATH, "w") as f:
            json.dump(cache, f, indent=2)

    print(f"Cache now has {len(cache)} entries")


if __name__ == "__main__":
    main()
