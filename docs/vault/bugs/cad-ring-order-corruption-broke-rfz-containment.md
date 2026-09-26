---
type: Bug
status: fixed
date: 2026-09-26
tags: [bug, cad, geospatial, rfz, m2]
related: ["[[cad-rings-simplified-with-douglas-peucker-after-farthest-point-corruption]]"]
---

# CAD ring-order corruption broke RFZ containment

## Symptom
- RFZ containment — the core of M2 — returned false negatives on roughly 3 in 10 CAD restricted zones: a zone's own centroid was reported as **outside** its own polygon.
- Reproduce: run `scripts/generate_cad_data.py`, then feed `src/data/cadRfzData.json` through `src/services/cadGeoJsonService.ts` into `src/services/geo/pointInPolygon.ts` and test each zone centroid against its own ring.
- Detected during independent verification at commit `4c663ab` — `VERIFICATION_REPORT.md` §3.

## Root cause
- `scripts/generate_cad_data.py:16-37` `compact_ring()` simplified rings by repeatedly picking the point **farthest from the last kept point** and popping it out of the remaining list:
  ```python
  best_i, best_d = 0, -1.0
  for i, p in enumerate(remaining):
      d = math.hypot(...)
      if d > best_d: best_d, best_i = d, i
  kept.append(remaining.pop(best_i))
  ```
- On a closed loop, "farthest from the last kept point" is on the **opposite side of the shape**. The output oscillated between opposite edges instead of tracing the perimeter, producing a self-intersecting sawtooth rather than a polygon. Point-in-polygon on a self-intersecting ring returns the wrong parity.

## Evidence
- `Tai Mo Shan Peak`, first 6 emitted points — latitude alternates high/low every step:
  ```text
  114.12451, 22.41461
  114.12436, 22.40558
  114.12481, 22.41460
  114.12406, 22.40560
  114.12511, 22.41457
  114.12376, 22.40563
  ```
- 85 of 135 rings zigzag (>50% of segments flip latitude direction); `Tai Mo Shan Peak` flips 45 times in 47 segments.
- Centroid containment before the fix: **40 of 135 zones (29.6%)** reported their own centroid as OUTSIDE.
- Separate defect in the same file: the perimeter-within-2% dedupe kept 135 of 286 source polygons, silently dropping **151 real zones** — e.g. Sai Kung Police Station, Marine East Divisional Base, Cape Collinson (Low-altitude Economy Regulatory Sandbox).
- Why the suite still passed 48/48: only one real containment assertion existed (`src/test/cadGeoJsonService.test.ts`), on `Tai Mo Shan Peak`, which happens to survive the corruption.

## Fix
- Replaced the greedy farthest-point picker with an **order-preserving** simplifier (Douglas-Peucker) — see [[CAD rings simplified with Douglas-Peucker after farthest-point corruption]].
- Replaced perimeter dedupe with **identity-based** dedupe (name + ring signature).
- Commits: `3f39ed9` (order-preserving simplification, identity dedupe, containment regression test) and `ecc9239` (assert the exact concave-ring centroid exception set).
- Result: zone count **135 → 284** (151 wrongly dropped now included; 2 genuine duplicates removed); centroid misses **40/135 → 21/284**, and the remaining 22 are real concavity (20 already fail against the unsimplified source rings).
- Stale "(135 zones)" labels fixed too: `src/services/dataBackends.ts:70` is now a memoised getter deriving the count from `loadCadZones().length`, and `TopBar.tsx` reads `resolveBackend(state.backendId).label` instead of a hardcoded string.

## Regression test
- `src/test/cadGeoJsonService.test.ts` — added an interior-point scanline test and an assertion of the exact concave-ring centroid exception set; `toBe(135)` updated to `toBe(284)` in three places.
- Assertion shape: every CAD zone must contain its own centroid, except the enumerated concave-ring set.

## Related
- [[cad-rings-simplified-with-douglas-peucker-after-farthest-point-corruption]]
