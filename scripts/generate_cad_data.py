import json, math, os, re

SRC = r"C:\Users\user\Downloads\bustaron_map_data\GeoJSON\map.geojson"
OUT = r"C:\Users\user\WorkBuddy AI\2026-09-24-21-39-57\src\data\cadRfzData.json"
MAX_RING = 48

def ring_perimeter(coords):
    total = 0.0
    for i in range(len(coords) - 1):
        lng1, lat1 = coords[i][0], coords[i][1]
        lng2, lat2 = coords[i + 1][0], coords[i + 1][1]
        total += math.hypot((lng2 - lng1) * math.cos(math.radians(22.3)) * 111320.0,
                            (lat2 - lat1) * 111320.0)
    return total

def compact_ring(coords):
    # coords: list of [lng, lat, 0]; keep first point, then greedily keep points
    # that maximise local coverage: always keep the point farthest from the
    # last-kept point, until MAX_RING points or ring end.
    pts = [(c[0], c[1]) for c in coords]
    if len(pts) <= MAX_RING:
        return [[p[0], p[1]] for p in pts]
    kept = [pts[0]]
    remaining = pts[1:-1]  # last equals first (closed ring)
    end = pts[-1]
    while len(kept) < MAX_RING - 1 and remaining:
        last = kept[-1]
        # pick farthest from last kept
        best_i, best_d = 0, -1.0
        for i, p in enumerate(remaining):
            d = math.hypot((p[0] - last[0]) * math.cos(math.radians(22.3)) * 111320.0,
                           (p[1] - last[1]) * 111320.0)
            if d > best_d:
                best_d, best_i = d, i
        kept.append(remaining.pop(best_i))
    kept.append(end)
    return [[p[0], p[1]] for p in kept]

def main():
    with open(SRC, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = []
    seen = set()
    for feat in data["features"]:
        props = feat.get("properties", {})
        geom = feat.get("geometry", {})
        if geom.get("type") != "Polygon":
            continue
        name = props.get("name", "Unnamed zone")
        ztype = props.get("type", "RFZ")
        outer = geom["coordinates"][0]
        per = ring_perimeter(outer)
        # near-duplicate detection: same type + similar perimeter (within 2%)
        key = (ztype, round(per / max(per * 0.02, 1.0)))
        dup = False
        for (t, p) in seen:
            if t == ztype and abs(p - per) <= max(per * 0.02, 1.0):
                dup = True
                break
        if dup:
            continue
        seen.add((ztype, per))
        coords = compact_ring(outer)
        features.append({
            "id": "cad-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] + "-" + str(len(features) + 1),
            "name": name,
            "type": ztype,
            "designation": props.get("description2", "Designated by CAD"),
            "effective": props.get("effectiveDateTime", "Effective until further notice"),
            "ring": {"closed": True, "coords": coords},
        })

    out = {
        "source": "CAD HK RFZ pack via bustaron_map_data/GeoJSON/map.geojson",
        "ingestedIso": "2026-09-26T00:00:00.000Z",
        "features": features,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("features:", len(features))
    print("bytes:", os.path.getsize(OUT))
    # sanity: report largest ring length kept
    print("max ring pts:", max(len(ft["ring"]["coords"]) for ft in features))

if __name__ == "__main__":
    main()
