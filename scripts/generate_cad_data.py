import hashlib
import json
import math
import os
import re

SRC = r"C:\Users\user\Downloads\bustaron_map_data\GeoJSON\map.geojson"
OUT = r"C:\Users\user\WorkBuddy AI\2026-09-24-21-39-57\src\data\cadRfzData.json"
MAX_RING = 48
# Hong Kong latitude used to normalise longitude into "latitude degrees" so that
# the Douglas-Peucker tolerance is isotropic in metres rather than in raw degrees.
_LNG_SCALE = math.cos(math.radians(22.3))
# Starting perpendicular tolerance, in normalised degrees (~1.1 m at HK latitude).
_EPS0 = 1e-5
_EPS_GROWTH = 1.6
_EPS_ITERATIONS = 64
_EPS_BISECT = 24


def _perp_dist(p, a, b):
    """Perpendicular distance from p to segment ab, in normalised degrees."""
    ax, ay = a[0] * _LNG_SCALE, a[1]
    bx, by = b[0] * _LNG_SCALE, b[1]
    px, py = p[0] * _LNG_SCALE, p[1]
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0.0:
        return math.hypot(px - ax, py - ay)
    return abs(dy * (px - ax) - dx * (py - ay)) / math.sqrt(length_sq)


def _douglas_peucker(line, eps):
    """Order-preserving Douglas-Peucker simplification of an open polyline.

    Implemented with an explicit stack: recursion depth on a 13k-vertex ring
    would otherwise blow Python's recursion limit.
    """
    n = len(line)
    if n <= 2:
        return list(line)
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        best_d, best_k = -1.0, -1
        a, b = line[i], line[j]
        for k in range(i + 1, j):
            d = _perp_dist(line[k], a, b)
            if d > best_d:
                best_d, best_k = d, k
        if best_d > eps:
            keep[best_k] = True
            stack.append((i, best_k))
            stack.append((best_k, j))
    return [p for p, kept in zip(line, keep) if kept]


def _simplify_closed_ring(line, eps):
    """Simplifies a closed ring given as an open polyline (first point not repeated).

    The loop is cut into two halves so each half gets a non-degenerate chord;
    the halves are simplified independently and rejoined, preserving ring order.
    """
    if len(line) <= 3:
        return list(line)
    mid = len(line) // 2
    first = _douglas_peucker(line[: mid + 1], eps)
    second = _douglas_peucker(line[mid:] + [line[0]], eps)
    return first + second[1:]


def _decimate(line, limit):
    """Even-stride decimation fallback: order-preserving, always keeps both ends."""
    stride = max(1, math.ceil((len(line) - 1) / max(limit - 1, 1)))
    kept = line[::stride]
    if kept[-1] != line[-1]:
        kept.append(line[-1])
    return kept


def compact_ring(coords):
    """Reduces a GeoJSON [lng, lat, 0] ring to at most MAX_RING [lng, lat] points.

    Douglas-Peucker preserves the ring's traversal order, so the output still
    traces the perimeter. The previous implementation picked the point *farthest*
    from the last kept point, which on a closed loop jumps to the opposite side of
    the shape and produces a self-intersecting sawtooth instead of a polygon.
    """
    pts = [(c[0], c[1]) for c in coords]
    # Drop the duplicated closing vertex, then drop consecutive repeats.
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    deduped = [pts[0]]
    for p in pts[1:]:
        if p != deduped[-1]:
            deduped.append(p)
    pts = deduped
    if len(pts) <= MAX_RING:
        return [[p[0], p[1]] for p in pts + [pts[0]]]

    eps = _EPS0
    simplified = None
    for _ in range(_EPS_ITERATIONS):
        simplified = _simplify_closed_ring(pts, eps)
        if len(simplified) <= MAX_RING:
            break
        eps *= _EPS_GROWTH
    if simplified is None or len(simplified) > MAX_RING:
        simplified = _decimate(pts, MAX_RING)
    else:
        # Bisect between the last epsilon that overflowed and the first that fit,
        # so the ring spends its full point budget instead of stopping at the
        # first (deliberately coarse) tolerance that happened to fit.
        lo = eps / _EPS_GROWTH
        hi = eps
        for _ in range(_EPS_BISECT):
            mid = (lo + hi) / 2.0
            candidate = _simplify_closed_ring(pts, mid)
            if len(candidate) <= MAX_RING:
                simplified = candidate
                hi = mid
            else:
                lo = mid
    return [[p[0], p[1]] for p in simplified + [simplified[0]]]


def _identity_signature(name, ring):
    """Real identity of a zone: normalised name + hash of the ring coordinates.

    The previous signature was (type, perimeter within 2%), which collapsed
    distinct zones that happened to have a similar outline length.
    """
    norm = re.sub(r"\s+", " ", str(name)).strip().lower()
    digest = hashlib.sha1(
        json.dumps([[round(c[0], 6), round(c[1], 6)] for c in ring]).encode("utf-8")
    ).hexdigest()
    return (norm, digest)


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
        signature = _identity_signature(name, outer)
        if signature in seen:
            continue
        seen.add(signature)
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
