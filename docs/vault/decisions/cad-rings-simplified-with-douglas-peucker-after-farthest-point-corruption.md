---
type: Decision
status: accepted
date: 2026-09-26
tags: [decision, cad, geospatial, m2]
related: ["[[cad-ring-order-corruption-broke-rfz-containment]]"]
---

# CAD rings simplified with Douglas-Peucker after farthest-point corruption

## Context
- `compact_ring()` in `scripts/generate_cad_data.py` simplified rings by repeatedly picking the point farthest from the last kept point. On a closed loop that jumps to the opposite side of the shape, producing self-intersecting zigzag rings. Full defect and evidence: [[CAD ring-order corruption broke RFZ containment]].
- RFZ point-in-polygon is the core of M2, and the corrupt rings produced false negatives on roughly 30% of zones.

## Options considered
1. **Keep the greedy picker and repair the order afterwards** — cheap, but reordering a self-intersecting ring is itself ambiguous.
2. **Even-stride decimation** — trivially order-preserving and a quick stopgap, but drops vertices with no regard for shape fidelity.
3. **Douglas-Peucker simplification** — order-preserving, standard, and keeps the significant vertices within a tolerance.

## Decision
- Replace the greedy farthest-point picker with order-preserving Douglas-Peucker simplification.

## Consequences
- **Positive** — rings trace the perimeter again; containment is geometrically meaningful; zone count and centroid behaviour became verifiable.
- **Negative / trade-offs** — the simplification tolerance is now a tunable affecting fidelity versus file size; the generated pack grew 217 KB → 364 KB (still under the 1 MB threshold).
- **Follow-ups** — none outstanding; the loose dedupe heuristic was fixed in the same change.

## Who / when
- Decided by: `geo-eng`; verified by team-lead (`TRACE.md` T2)
- Date: 2026-09-26
- Commits: `3f39ed9`, `ecc9239`

## Related
- [[cad-ring-order-corruption-broke-rfz-containment]]
