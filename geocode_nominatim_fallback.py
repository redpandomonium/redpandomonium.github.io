"""Second pass: resolve cache entries flagged needs_nominatim using Nominatim
(1 req/sec, per usage policy)."""
import json
import time

import requests

CACHE_PATH = "geocode_cache.json"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


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
    with open(CACHE_PATH) as f:
        cache = json.load(f)

    targets = [k for k, v in cache.items() if v is not None and v.get("needs_nominatim")]
    print(f"{len(targets)} entries need nominatim")

    for company in targets:
        address = cache[company]["address"]
        try:
            lonlat = geocode_nominatim(address)
        except Exception as e:
            print(f"Nominatim error for {company!r}: {e}")
            lonlat = None

        if lonlat is None:
            print(f"STILL FAILED: {company!r} ({address!r})")
            cache[company] = None
        else:
            print(f"OK (Nominatim): {company!r} -> {lonlat}")
            cache[company] = {"lon": lonlat[0], "lat": lonlat[1], "source": "Nominatim"}

        with open(CACHE_PATH, "w") as f:
            json.dump(cache, f, indent=2)
        time.sleep(1)


if __name__ == "__main__":
    main()
