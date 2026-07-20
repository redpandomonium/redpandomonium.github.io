"""Assemble the final employers_geocoded.geojson from companies.json
(all 127 merged companies) + geocode_cache.json (lat/long for the 90 that
didn't already have coordinates), writing both the root and public copies
in the schema App.jsx expects.
"""
import json

COMPANIES_JSON = "companies.json"
CACHE_PATH = "geocode_cache.json"
OUTPUT_PATHS = ["employers_geocoded.geojson", "public/employers_geocoded.geojson"]

PROPERTY_COLUMNS = [
    "company", "operational_status", "business_type", "vehicle_type",
    "fleet_size", "full_address", "street_address", "city", "state", "zip",
    "phone", "email", "website", "contact_first", "contact_last",
    "contact_role", "open_job_count", "job_titles", "job_types",
    "apply_urls", "latest_scrape", "notes",
]


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
    with open(CACHE_PATH) as f:
        cache = json.load(f)

    features = []
    skipped = []

    for rec in companies:
        company = rec["company"]
        jobs = rec.get("jobs") or []

        if rec.get("latitude") is not None and rec.get("longitude") is not None:
            lon, lat, source = rec["longitude"], rec["latitude"], (rec.get("geocode_source") or "Census")
        else:
            entry = cache.get(company)
            if not entry:
                skipped.append(company)
                continue
            lon, lat, source = entry["lon"], entry["lat"], entry["source"]

        properties = {col: rec.get(col) for col in PROPERTY_COLUMNS}
        properties["open_job_count"] = rec.get("matched_job_count", rec.get("open_job_count"))
        properties["job_titles"] = job_titles_string(jobs) or rec.get("job_titles")
        properties["job_types"] = job_types_string(jobs) or rec.get("job_types")
        properties["apply_urls"] = apply_urls_string(jobs) or rec.get("apply_urls")
        properties["geocode_source"] = source

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": properties,
        })

    geojson = {"type": "FeatureCollection", "features": features}

    for path in OUTPUT_PATHS:
        with open(path, "w") as f:
            json.dump(geojson, f, indent=2)
        print(f"Wrote {len(features)} features to {path}")

    if skipped:
        print("Skipped (no coordinates found):", skipped)


if __name__ == "__main__":
    main()
