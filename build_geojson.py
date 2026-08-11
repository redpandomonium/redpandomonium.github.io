"""Assemble the final employers_geocoded.geojson from employers_master.xlsx
(Employers sheet), writing both the root and public copies in the schema
App.jsx expects.
"""
import json
import re

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
    # Scope resolution (added 2026-08-04). These drive the corridor filter in
    # App.jsx. They must stay in this list or a rebuild silently drops them
    # from the map and every employer falls back to "unclassified".
    "zip_parsed", "geo_bucket", "in_scope", "zone",
]

# The 12 target ZIP codes, split into the two zones the map labels separately.
# This list was not previously recorded anywhere in the repo -- it was
# reconstructed and confirmed on 2026-08-04. It is the single source of truth
# for `zone` and `in_scope`. If it changes, regenerate both columns in
# employers_master.xlsx.
SW_DETROIT = {
    "48209",  # Mexicantown / Springwells
    "48210",  # Southwest Detroit
    "48216",  # Corktown / industrial riverfront
    "48217",  # Boynton / Oakwood Heights
}

AROUND_SW_DETROIT = {
    "48218",  # River Rouge
    "48229",  # Ecorse
    "48120",  # Dearborn / Springwells edge
    "48122",  # Melvindale
    "48146",  # Lincoln Park
    "48192",  # Wyandotte
    "48193",  # Riverview
    "48183",  # Trenton / Woodhaven
}

CORE_12 = SW_DETROIT | AROUND_SW_DETROIT

# Detroit ZIPs outside the 12. Present on the map, labelled plainly as Detroit.
DETROIT_OTHER = {
    "48201", "48202", "48203", "48207", "48211", "48213", "48214",
    "48226", "48227", "48228", "48238", "48239", "48223", "48235", "48126",
}


def zone_for(zip_code):
    """Map a ZIP to the label shown on the map."""
    if zip_code in SW_DETROIT:
        return "Southwest Detroit"
    if zip_code in AROUND_SW_DETROIT:
        return "Around Southwest Detroit"
    if zip_code in DETROIT_OTHER:
        return "Detroit"
    return "Outside the area"


def main():
    wb = openpyxl.load_workbook(MASTER_XLSX, read_only=True)
    ws = wb[SHEET_NAME]
    rows = ws.iter_rows(values_only=True)
    header = next(rows)

    features = []
    skipped = []
    missing_scope = []

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

        # Guard: if the scope columns are missing from the spreadsheet (an older
        # copy, or a fresh export), fall back to deriving them from the address
        # rather than writing nulls the map cannot interpret.
        if not properties.get("zone") or not properties.get("in_scope"):
            parsed = properties.get("zip_parsed")
            if not parsed:
                match = re.search(r"\b(48\d{3})\b", str(rec.get("full_address") or ""))
                parsed = match.group(1) if match else None
                properties["zip_parsed"] = parsed
            zone = zone_for(parsed)
            properties["zone"] = zone
            properties["in_scope"] = (
                "Yes" if parsed in CORE_12 else ("Review" if zone == "Detroit" else "No")
            )
            missing_scope.append(company)

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

    zone_counts = {}
    for feature in features:
        value = feature["properties"].get("zone")
        zone_counts[value] = zone_counts.get(value, 0) + 1
    print("zones:", zone_counts)

    if skipped:
        print("Skipped (no coordinates found):", skipped)

    if missing_scope:
        print(
            f"WARNING: {len(missing_scope)} rows had no in_scope value in the "
            "spreadsheet and were derived from the ZIP instead. Re-run the "
            "scope pass on employers_master.xlsx to make this authoritative:",
            missing_scope[:10],
        )


if __name__ == "__main__":
    main()
