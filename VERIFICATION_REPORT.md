# Verification Report — BUSTARON M1/M2 handoff claims

Verified 2026-09-26 17:10 GMT+8 against the working tree at commit `4c663ab`.

## Verdict

**The headline claims are TRUE — M1 and M2 are real, and every gate is green.**
**But the CAD RFZ data has two substantive defects that the passing tests do not catch.**

---

## 1. Claims confirmed ✅

| Claim | Verified |
|---|---|
| Git repo, branch `main` | ✅ clean tree, no uncommitted changes |
| Commits `081e985` / `205f696` / `4c663ab` | ✅ all three present, in that order |
| `tsc -b` green | ✅ exit 0 |
| `vite build` green | ✅ exit 0 — 66 modules, `dist/assets/index-s__rKn9F.js` 408.40 kB |
| `eslint . --max-warnings=0` green | ✅ exit 0, zero warnings |
| `vitest run` **48/48** | ✅ 6 files, 48 tests, 4.39 s |
| `src/services/dataBackend.ts` is the M3 seam | ✅ `DataBackend` interface with `loadInitialState`, `loadZones`, `simulateTick`, `listZones`, `loadFleet`, `loadMissions`, `loadWeatherAlerts`; `BackendId = 'mock' \| 'cad-geojson'` |
| 135 CAD RFZ zones in `src/data/cadRfzData.json` | ✅ exactly 135 features |
| `scripts/generate_cad_data.py` regenerates it | ✅ present |
| A* planner at `src/services/routePlanner.ts` | ✅ present (12,476 bytes) |
| `scripts/probe_routes.ts` | ✅ present |
| `src/services/creditsService.ts` | ✅ present (10,640 bytes) |
| `CreditWalletPanel` / `ApprovalsQueuePanel` | ✅ both present |
| `docs/milestone-02.md` | ✅ present (5,648 bytes) |
| Dev server on `127.0.0.1:4173` | ✅ LISTENING, PID 23544 |
| Bun runtime at the given path | ✅ `bun.exe` present, v1.4.2 — all four gates run fine under it |
| No `*.DELETE.*` guard damage | ✅ none found |

Test breakdown: `pointInPolygon` 9 · `creditsService` 14 · `routePlanner` 7 · `cadGeoJsonService` 11 · `App` 3 · `m2Flows` 4 = 48.

---

## 2. Claims that are wrong or misleading ⚠️

### "There is NO Node.js on this machine"
**Not universally true.** Node **v24.14.0** is installed at
`C:\Users\user\.workbuddy-ai\binaries\node\versions\24.14.0\node`, and the `./node_modules/.bin/*`
shims run correctly here. The "no node" condition is specific to the FreeBuff process
environment (restricted `PATH`), not the machine.

Keep the bun instructions — they're correct and they work — but write the rule as
*"Node may not be on PATH in your process; prefer bun"* rather than *"there is no Node.js"*.
Otherwise a future agent that *does* have Node may waste time hunting for a runtime that exists.

---

## 3. Bugs found that the handoff does NOT mention 🐛

### BUG 1 — `compact_ring()` destroys polygon ring order (severity: **high**)

`scripts/generate_cad_data.py:16-37` simplifies rings by repeatedly picking the point
**farthest from the last kept point** and popping it out of the remaining list:

```python
best_i, best_d = 0, -1.0
for i, p in enumerate(remaining):
    d = math.hypot(...)
    if d > best_d: best_d, best_i = d, i
kept.append(remaining.pop(best_i))
```

"Farthest from last kept" on a closed loop means **on the opposite side of the shape**.
So the output oscillates between opposite edges instead of tracing the perimeter. The
result is a self-intersecting sawtooth, not a polygon.

Evidence — `Tai Mo Shan Peak`, first 6 emitted points (lat alternates high/low every step):
```
114.12451, 22.41461
114.12436, 22.40558
114.12481, 22.41460
114.12406, 22.40560
114.12511, 22.41457
114.12376, 22.40563
```

Measured across the pack: **85 of 135 rings zigzag** (>50% of segments flip latitude direction;
`Tai Mo Shan Peak` flips 45 times in 47 segments).

**Functional impact:** point-in-polygon on a self-intersecting ring returns wrong parity.
Testing each zone's own centroid against its own ring:

> **40 of 135 zones (29.6%) report their own centroid as OUTSIDE.**
> e.g. Tai Mo Shan Terminal Area Radar Station, Sha Tin Racecourse, Tate's Cairn Police Post,
> Smugglers Ridge Firing Range, New Territories South Regional Police HQ.

So RFZ containment — the core of M2 — gives false negatives on roughly 3 in 10 zones.
These rings flow straight into `src/services/cadGeoJsonService.ts`, which builds
`AirspaceZone` objects from them, and into `src/services/geo/pointInPolygon.ts`.

**Fix:** replace the greedy farthest-point picker with an **order-preserving** simplifier —
Douglas–Peucker, or even-stride decimation as a quick stopgap. Both preserve perimeter order.

### BUG 2 — dedupe drops 53% of the source zones (severity: **medium-high**)

Source `map.geojson` contains **286** polygons. The generator emits **135**.
Simulating its logic: **kept 135, dropped 151 as "near-duplicates"** — judged purely by
perimeter within 2% and matching `type`.

That heuristic is far too loose. Real, distinct zones were discarded, e.g.:
`Sai Kung Police Station`, `Marine East Divisional Base`, `Tsuen Wan Police Station`,
`Customs and Excise Department Tsing Yi Station`, `Cape Collinson (Low-altitude Economy
Regulatory Sandbox)`, `Chai Wan Police Station`.

For a regulatory airspace product, silently dropping 151 restricted zones is a correctness
problem, not a compression win.

**Fix:** dedupe on a real identity — name + ring signature (e.g. hash of rounded coordinates),
or drop dedupe entirely and let the viewport filter handle density.

### BUG 3 — dead code
`scripts/generate_cad_data.py:55` computes `key = (ztype, round(per / max(per * 0.02, 1.0)))`
and never uses it. The loop below uses a different comparison. Harmless, but misleading.

---

## 4. Why 48/48 tests pass anyway

The suite never exercises real CAD ring geometry at scale. `src/test/cadGeoJsonService.test.ts`
contains exactly **one** real containment assertion:

```ts
const hits = evaluateZonesAtPoint({ lat: 22.4101, lng: 114.1245 }, zones);
expect(hits.some((hit) => hit.zone.name === 'Tai Mo Shan Peak')).toBe(true);
```

`Tai Mo Shan Peak` happens to be one of the zones that survives the corruption (its centroid
*does* test inside). The other 40 broken zones are never asserted against. The `pointInPolygon`
unit tests (9) use synthetic rings, which are valid.

**Recommended regression test to add before M3:**
```ts
it('every CAD zone contains its own centroid', () => {
  for (const zone of loadCadZones()) {
    const c = centroid(zone.polygon);
    expect(evaluateZonesAtPoint(c, [zone]).length).toBe(1);
  }
});
```
This fails today (40 cases) and passes once BUG 1 is fixed. It also guards the dedupe fix.

---

## 5. Recommended order for the next agent

1. **Fix BUG 1** — order-preserving ring simplification in `scripts/generate_cad_data.py`.
2. **Fix BUG 2** — identity-based dedupe (or none). Expect the zone count to rise well above 135;
   update `cadGeoJsonService.test.ts`'s `expect(zones.length).toBe(135)` accordingly.
3. Regenerate `src/data/cadRfzData.json`, add the centroid regression test, re-run all four gates.
4. Remove dead `key` variable.
5. **Then** start M3 (FastAPI + PoA ledger + agents behind the `DataBackend` seam).

Do not build M3's geospatial logic on top of the current rings — it would inherit false
negatives into the backend's compliance checks.

## 6. Commands that work here (verified)

```bash
B="C:/Users/user/AppData/Local/Programs/@codebufffreebuff-desktop/resources/bun/bun.exe"
"$B" node_modules/typescript/bin/tsc -b
"$B" node_modules/vite/bin/vite.js build
"$B" node_modules/eslint/bin/eslint.js . --max-warnings=0
"$B" node_modules/vitest/vitest.mjs run
```
Every one of these returned exit 0 this session.
