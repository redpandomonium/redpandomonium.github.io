"""Assemble the final employers_geocoded.geojson from employers_master.xlsx
(Employers sheet), writing both the root and public copies in the schema
App.jsx expects.
"""
import json
import openpyxl

MASTER_XLSX = "employers_master.xlsx"
SHEET_NAME = "Employers"
OUTPUT_PATHS = ["employers_geocoded.geojson", "public/employers_geocoded.geojson"]

PROPERTY_COLUMNS = [
    "company", "operational_status", "business_type", "category", "sub_category",
    "vehicle_type", "fleet_size", "full_address", "street_address", "city", "state",
    "zip", "phone", "email", "website", "contact_first", "contact_last",
    "contact_role", "open_job_count", "job_titles", "job_types",
    "apply_urls", "latest_scrape", "notes", "geocode_source",
]


def main():
    wb = openpyxl.load_workbook(MASTER_XLSX, read_only=True)
    ws = wb[SHEET_NAME]
    rows = ws.iter_rows(values_only=True)
    header = next(rows)

    features = []
    skipped = []

    for row in rows:
        rec = dict(zip(header, row))
        company = rec.get("company")
        if not company:
            continue

        lat, lon = rec.get("lat"), rec.get("lon")
        if lat is None or lon is None:
            skipped.append(company)
            continue

        properties = {col: rec.get(col) for col in PROPERTY_COLUMNS}

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
