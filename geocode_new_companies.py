"""Geocode the ~90 newly-researched companies in companies.json that don't
yet have latitude/longitude, using the same Census-first / Nominatim-fallback
approach as geocode_employers.py, then merge everything into
employers_geocoded.geojson (root + public copies) in the schema App.jsx expects.
"""
import json
import sys
import time

import requests
from geopy.geocoders import Nominatim

COMPANIES_JSON = "companies.json"
OUTPUT_PATHS = ["employers_geocoded.geojson", "public/employers_geocoded.geojson"]

CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
PROPERTY_COLUMNS = [
    "company", "operational_status", "business_type", "vehicle_type",
    "fleet_size", "full_address", "street_address", "city", "state", "zip",
    "phone", "email", "website", "contact_first", "contact_last",
    "contact_role", "open_job_count", "job_titles", "job_types",
    "apply_urls", "latest_scrape", "notes",
]

nominatim = Nominatim(user_agent="sdev-mapping-website-geocoder")


def geocode_census(address):
    resp = requests.get(
        CENSUS_URL,
        params={"address": address, "benchmark": "2020", "format": "json"},
        timeout=15,
    )
    resp.raise_for_status()
    matches = resp.json()["result"]["addressMatches"]
    if not matches:
        return None
    coords = matches[0]["coordinates"]
    return coords["x"], coords["y"]


def geocode_nominatim(address):
    location = nominatim.geocode(address, timeout=15)
    if location is None:
        return None
    return location.longitude, location.latitude


def job_titles_string(jobs):
    if not jobs:
        return None
    titles = [j.get("title") for j in jobs if j.get("title")]
    return " | ".join(titles) if titles else None


def job_types_string(jobs):
    if not jobs:
        return None
    types = sorted({j.get("job_type") for j in jobs if j.get("job_type")})
    return ", ".join(types) if types else None


def apply_urls_string(jobs):
    if not jobs:
        return None
    sources = sorted({j.get("source") for j in jobs if j.get("source")})
    return " | ".join(sources) if sources else None


def main():
    with open(COMPANIES_JSON) as f:
        companies = json.load(f)

    features = []
    counts = {"cached": 0, "census": 0, "nominatim": 0, "failed": 0}
    failed_companies = []

    for rec in companies:
        company = rec.get("company", "<unknown>")
        jobs = rec.get("jobs") or []

        lonlat = None
        source = rec.get("geocode_source")

        if rec.get("latitude") is not None and rec.get("longitude") is not None:
            lonlat = (rec["longitude"], rec["latitude"])
            source = source or "Census"
            counts["cached"] += 1
        else:
            address = rec.get("full_address")
            if not address or address == "NOT FOUND":
                print(f"SKIP (no address): {company}")
                counts["failed"] += 1
                failed_companies.append(company)
                continue

            try:
                lonlat = geocode_census(address)
                source = "Census"
            except requests.RequestException as e:
                print(f"Census error for {company!r}: {e}")

            if lonlat is None:
                time.sleep(1)  # Nominatim usage policy: max 1 req/sec
                try:
                    lonlat = geocode_nominatim(address)
                    source = "Nominatim"
                except Exception as e:
                    print(f"Nominatim error for {company!r}: {e}")

            if lonlat is None:
                print(f"FAILED to geocode: {company!r} ({address!r})")
                counts["failed"] += 1
                failed_companies.append(company)
                continue

            counts[source.lower()] += 1

        properties = {col: rec.get(col) for col in PROPERTY_COLUMNS}
        # Prefer freshly-matched job data over the raw scrape aggregates.
        properties["open_job_count"] = rec.get("matched_job_count", rec.get("open_job_count"))
        properties["job_titles"] = job_titles_string(jobs) or rec.get("job_titles")
        properties["job_types"] = job_types_string(jobs) or rec.get("job_types")
        properties["apply_urls"] = apply_urls_string(jobs) or rec.get("apply_urls")
        properties["geocode_source"] = source

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lonlat[0], lonlat[1]]},
            "properties": properties,
        })

    geojson = {"type": "FeatureCollection", "features": features}

    for path in OUTPUT_PATHS:
        with open(path, "w") as f:
            json.dump(geojson, f, indent=2)
        print(f"Wrote {len(features)} features to {path}")

    print(
        f"Done. Cached: {counts['cached']}, Census: {counts['census']}, "
        f"Nominatim: {counts['nominatim']}, Failed: {counts['failed']}"
    )
    if failed_companies:
        print("Failed companies:", failed_companies)


if __name__ == "__main__":
    main()
