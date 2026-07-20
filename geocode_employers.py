"""Geocode employers_master.xlsx into employers_geocoded.geojson.

Reads the "Employers" sheet, geocodes each row's address (Census geocoder
first, Nominatim as fallback), and writes a GeoJSON FeatureCollection to
both employers_geocoded.geojson and public/employers_geocoded.geojson.
"""
import json
import sys
import time

import pandas as pd
import requests
from geopy.geocoders import Nominatim

XLSX_PATH = "employers_master.xlsx"
SHEET_NAME = "Employers"
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


def build_address(row):
    full = row.get("full_address")
    if isinstance(full, str) and full.strip():
        return full.strip()
    parts = [row.get("street_address"), row.get("city"), row.get("state"), row.get("zip")]
    parts = [str(p).strip() for p in parts if isinstance(p, str) and p.strip()]
    return ", ".join(parts) if parts else None


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


def clean(value):
    if pd.isna(value):
        return None
    return value.item() if hasattr(value, "item") else value


def main():
    df = pd.read_excel(XLSX_PATH, sheet_name=SHEET_NAME)

    features = []
    counts = {"census": 0, "nominatim": 0, "failed": 0}

    for _, row in df.iterrows():
        address = build_address(row)
        company = row.get("company", "<unknown>")

        if not address:
            print(f"SKIP (no address): {company}")
            counts["failed"] += 1
            continue

        lonlat = None
        source = None
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
            continue

        counts[source.lower()] += 1
        properties = {col: clean(row.get(col)) for col in PROPERTY_COLUMNS}
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
        f"Done. Census: {counts['census']}, Nominatim: {counts['nominatim']}, "
        f"Failed: {counts['failed']}"
    )
    if counts["failed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
