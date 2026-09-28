"""Build the transit overlay (public/transit_routes.geojson and
public/transit_stops.geojson) from the agencies' published GTFS feeds.

    python3 build_transit_geojson.py            # re-download feeds, rebuild
    python3 build_transit_geojson.py --cached   # rebuild from transit_cache/

Standard library only. Re-run whenever an agency publishes a new service
change (DDOT and SMART both do so a few times a year -- feed_start/end dates
are printed at the end of each run so a stale feed is obvious).
"""
import csv
import io
import json
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

# (agency key, label shown on the map, GTFS URL). Sources found via the
# Mobility Database catalog (files.mobilitydatabase.org/feeds_v2.csv). The
# QLine feed's calendar ended 2025-12-31, but only its geometry is used here,
# and the track does not move.
FEEDS = [
    ("ddot", "DDOT", "https://www.detroitmi.gov/Portals/0/docs/deptoftransportation/pdfs/ddot_gtfs.zip"),
    ("smart", "SMART", "https://apps1.smartbus.org/gtfs/smart_gtfs.zip"),
    ("qline", "QLine", "http://data.trilliumtransit.com/gtfs/qline-mi-us/qline-mi-us.zip"),
    ("dpm", "People Mover", "https://hosted-gtfs-feeds.s3.amazonaws.com/DPM/gtfs.zip"),
]

CACHE_DIR = Path("transit_cache")
ROUTES_OUT = Path("public/transit_routes.geojson")
STOPS_OUT = Path("public/transit_stops.geojson")

# Same box as the MapContainer's maxBounds in App.jsx -- nothing outside it
# can ever be panned to, so it is not worth shipping.
MIN_LAT, MIN_LNG, MAX_LAT, MAX_LNG = 41.95, -84.0, 42.8, -82.65

# ~5 m. Plenty for lines drawn at zoom 10-18 and cuts the file by ~90%.
SIMPLIFY_TOLERANCE = 0.00005
# A route can have a dozen shape variants (short-turns, garage trips). Keep
# only the ones carrying a real share of that route's trips, so genuine
# branches survive but one-off deadhead patterns don't clutter the map.
MIN_SHAPE_TRIP_SHARE = 0.10


def in_bounds(lat, lng):
    return MIN_LAT <= lat <= MAX_LAT and MIN_LNG <= lng <= MAX_LNG


def read_csv(zf, name):
    with zf.open(name) as f:
        # utf-8-sig: some feeds start with a BOM, which would otherwise end
        # up glued to the first column name.
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def simplify(points, tol):
    """Douglas-Peucker, iterative so long SMART routes can't hit the
    recursion limit. points: list of (lng, lat)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        (x1, y1), (x2, y2) = points[start], points[end]
        dx, dy = x2 - x1, y2 - y1
        seg_len_sq = dx * dx + dy * dy
        max_dist, index = 0.0, None
        for i in range(start + 1, end):
            px, py = points[i]
            if seg_len_sq == 0:
                dist = (px - x1) ** 2 + (py - y1) ** 2
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / seg_len_sq))
                dist = (px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2
            if dist > max_dist:
                max_dist, index = dist, i
        if index is not None and max_dist > tol * tol:
            keep[index] = True
            stack.append((start, index))
            stack.append((index, end))
    return [p for p, k in zip(points, keep) if k]


def fetch(key, url, use_cache):
    path = CACHE_DIR / f"{key}.zip"
    if not (use_cache and path.exists()):
        print(f"  downloading {url}")
        CACHE_DIR.mkdir(exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "community-view-map"})
        with urllib.request.urlopen(req, timeout=120) as res:
            path.write_bytes(res.read())
    return zipfile.ZipFile(path)


def build_feed(key, label, zf):
    routes = {r["route_id"]: r for r in read_csv(zf, "routes.txt")}

    trip_route = {}
    shape_trips = defaultdict(Counter)  # route_id -> Counter(shape_id)
    for t in read_csv(zf, "trips.txt"):
        trip_route[t["trip_id"]] = t["route_id"]
        if t.get("shape_id"):
            shape_trips[t["route_id"]][t["shape_id"]] += 1

    wanted_shapes = {}
    for route_id, counts in shape_trips.items():
        total = sum(counts.values())
        for shape_id, n in counts.items():
            if n / total >= MIN_SHAPE_TRIP_SHARE:
                wanted_shapes[shape_id] = route_id

    shape_pts = defaultdict(list)
    for s in read_csv(zf, "shapes.txt"):
        if s["shape_id"] in wanted_shapes:
            shape_pts[s["shape_id"]].append(
                (int(s["shape_pt_sequence"]), float(s["shape_pt_lon"]), float(s["shape_pt_lat"]))
            )

    route_lines = defaultdict(list)
    seen = set()
    for shape_id, pts in shape_pts.items():
        pts.sort()
        line = simplify([(lng, lat) for _, lng, lat in pts], SIMPLIFY_TOLERANCE)
        line = [[round(lng, 5), round(lat, 5)] for lng, lat in line]
        sig = tuple(map(tuple, line))
        # Opposite directions often share an identical path; drawing both
        # just doubles the opacity of that line.
        if sig in seen or tuple(reversed(sig)) in seen:
            continue
        seen.add(sig)
        route_lines[wanted_shapes[shape_id]].append(line)

    route_features = []
    for route_id, lines in route_lines.items():
        if not any(in_bounds(lat, lng) for line in lines for lng, lat in line):
            continue
        r = routes[route_id]
        route_features.append({
            "type": "Feature",
            "properties": {
                "agency": key,
                "agency_label": label,
                "route": r.get("route_short_name") or "",
                "name": r.get("route_long_name") or r.get("route_short_name") or "",
                # 0 tram/light rail, 1 subway, 2 rail, 3 bus -- App.jsx draws
                # rail heavier than bus.
                "route_type": int(r.get("route_type") or 3),
            },
            "geometry": {"type": "MultiLineString", "coordinates": lines},
        })

    # Which routes serve each stop, for the stop tooltip. stop_times is the
    # only place that link exists (DDOT's is ~1M rows; streaming is fine).
    stop_routes = defaultdict(set)
    for st in read_csv(zf, "stop_times.txt"):
        route_id = trip_route.get(st["trip_id"])
        if route_id:
            stop_routes[st["stop_id"]].add(route_id)

    def route_sort_key(route_name):
        return (0, int(route_name)) if route_name.isdigit() else (1, route_name)

    stop_features = []
    for s in read_csv(zf, "stops.txt"):
        # location_type 1 = parent station; its platforms carry the service.
        if s.get("location_type") not in (None, "", "0"):
            continue
        if not s.get("stop_lat") or s["stop_id"] not in stop_routes:
            continue
        lat, lng = float(s["stop_lat"]), float(s["stop_lon"])
        if not in_bounds(lat, lng):
            continue
        names = sorted(
            {routes[rid].get("route_short_name") or routes[rid].get("route_long_name") or rid
             for rid in stop_routes[s["stop_id"]]},
            key=route_sort_key,
        )
        stop_features.append({
            "type": "Feature",
            "properties": {"agency": key, "name": s["stop_name"].strip(), "routes": names},
            "geometry": {"type": "Point", "coordinates": [round(lng, 5), round(lat, 5)]},
        })

    return route_features, stop_features


def main():
    use_cache = "--cached" in sys.argv
    all_routes, all_stops = [], []
    for key, label, url in FEEDS:
        print(f"{label}:")
        zf = fetch(key, url, use_cache)
        info = next(read_csv(zf, "feed_info.txt"), {}) if "feed_info.txt" in zf.namelist() else {}
        routes, stops = build_feed(key, label, zf)
        print(f"  {len(routes)} routes, {len(stops)} stops "
              f"(feed valid {info.get('feed_start_date', '?')} - {info.get('feed_end_date', '?')})")
        all_routes += routes
        all_stops += stops

    for path, features in ((ROUTES_OUT, all_routes), (STOPS_OUT, all_stops)):
        path.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                   separators=(",", ":")))
        print(f"wrote {path} ({path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
