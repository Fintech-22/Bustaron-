# Milestone 2 — Planning + Data Adapters

Status: **complete, all four gates green** (see §Verification).

## What was built

M2 replaces the M1 "hard-coded mock" seam with real adapter boundaries, ingests
the supplied CAD geodata, and adds the planning + credits product flows, while
keeping the app fully functional with **zero network access**.

### 1. Data adapter boundary (the M1→M2 seam)

`src/services/dataBackend.ts` defines the `DataBackend` interface
(`loadInitialState`, `loadZones`, `listZones(bounds)`, `loadFleet`,
`loadMissions`, `loadWeatherAlerts`, `simulateTick`, plus `id/label/
offlineCapable/usesIngestedGeodata` metadata).

Two implementations live in `src/services/dataBackends.ts`:

- `MockBackend` (`mock`) — the M1 deterministic replay, unchanged. **Default.**
- `CadGeoJsonBackend` (`cad-geojson`) — swaps the 3 schematic mock zones for the
  ingested CAD RFZ pack; fleet/missions/weather stay mock until M3 live feeds.

`src/store/dashboardStore.ts` resolves the active backend via
`resolveBackend(id)`; the Credit Wallet panel exposes a source selector. The
`mockDataService` seam is preserved — the store only talks to the interface.

### 2. CAD geodata ingestion

Source: `C:\Users\user\Downloads\bustaron_map_data\GeoJSON\map.geojson`
(286 RFZ polygon features, 3 MB).

`scripts/generate_cad_data.py` (documented generator, run once, not part of the
build) compacts it to `src/data/cadRfzData.json` (~217 KB, 135 unique zones,
rings simplified to ≤48 points each, near-duplicate rings dropped). The KML
variant carries identical content and is intentionally not bundled.

`src/services/cadGeoJsonService.ts` parses the JSON into typed `AirspaceZone`s
(`[lng,lat]` → `{lat,lng}`) and caches defensively.

### 3. RFZ point-in-polygon

`src/services/geo/pointInPolygon.ts`:

- ray-casting PIP (handles concave rings, degenerate inputs);
- bbox computation + cheap rectangular pre-filter (buffer-aware);
- local equirectangular metre projection around a HK centroid + inverse;
- haversine distance; point-to-segment/ring distance for buffer queries;
- `evaluateZonesAtPoint(point, zones, bufferM)` returning every zone hit with
  containment or `distanceM ≤ bufferM`.

### 4. A* route planning

`src/services/routePlanner.ts` — A* over a rectangular lattice (default 600 m
spacing, configurable) in the metre projection:

- only `rfz`/`sensitive` zones block; `corridor` zones are discounted (×0.45)
  rather than blocking, `heliport` zones merely require notification;
- restricted rings are inflated by `marginM` (default 60 m); nodes inside the
  margin are pruned before the search runs;
- binary-heap open set; start/goal snap to lattice nodes; exact start/goal
  points are spliced back into the returned polyline;
- returns `waypoints`, `distanceM`, `corridorDistanceM`, `nodesExpanded`;
  throws when start/goal is inside a margin or the goal is walled off.

The Mission panel's flight draft offers origin/destination pickers and a
"Plan A* route" action; the planned route is drawn on the tactical map as a
dashed cyan polyline.

### 5. Credits / auction flows

`src/services/creditsService.ts` (pure, typed, unit-tested):

- `quoteRouteCredits(distanceM, highRiskSegments)` — 100 credits per 100 km
  plus 25 per high-risk segment;
- `placeBid` — escrows credits (balance → reserved), enforces reserve/balance;
- `awardAuction` — highest bid wins (earliest submission breaks ties); losing
  reservations released, winning reservation held until settlement;
- `settleAuction` — winning credits transfer to the corridor owner;
- `fileApprovalRequest` / `decideApproval` — escrow on filing; approval burns
  the escrow, rejection refunds it; every movement appends to the ledger.

UI: `CreditWalletPanel` (wallet cards, auction cards with bid form + presets +
award button, ledger feed, data-source selector) and `ApprovalsQueuePanel`
(pending queue with approve/reject). Nav gained `wallet` and `approvals`
sections; `approvals` is admin-only. Errors surface via a `role="alert"` line.

### 6. Accessibility & theme

- all new controls are real `<button>`/`<select>`/`<input>` elements;
- toggle groups keep `role="group"` + `aria-pressed` (bid presets, data source);
- new landmark groups carry aria-labels; alerts use `role="alert"`;
- extended the M1 dark tactical tokens — no new color system introduced.

## Verification (2026-09-26)

| Command (direct binaries via bun runtime) | Result |
|---|---|
| `tsc -b` | exit 0 |
| `vite build` | exit 0 (JS bundle 407.92 kB, gzip 138.15 kB — the CAD pack accounts for the growth) |
| `eslint . --max-warnings=0` | exit 0, zero warnings |
| `vitest run` | **47/47 pass** (6 files) |

Test files: `App.test.tsx` (M1 regression, 3), `pointInPolygon.test.ts` (9),
`routePlanner.test.ts` (7), `creditsService.test.ts` (12),
`cadGeoJsonService.test.ts` (11), `m2Flows.test.tsx` (UI flows, 4).

## Deliberate scope decisions

- The KML file is not parsed at runtime; it duplicates the GeoJSON and the
  GeoJSON path is the one wired into the app.
- Feature-perimeter dedup removed 151 of 286 features (many are the same
  designated area repeated per district); 134/135 zones fall inside the HK bbox.
- No live network fetches anywhere — adapters are the seam where M3 will add
  real HKO/LandsD/CAD clients.

## Known follow-ups for M3

- Persist auction/approval state server-side (currently in-memory store).
- Add live HKO weather + LandsD terrain adapters behind the same interface.
- Corridor allocation currently settles to a fixed owner wallet id; wire the
  actual corridor-registry ownership lookup when the ledger lands.
