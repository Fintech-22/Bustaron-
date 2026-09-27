---
Title: T12 — HKO weather evidence tab, real 3-node PoA, 3D View
Tags: [session, m3, weather, poa, cesium, 3d]
Date: 2026-09-27
---

# T12 — HKO weather evidence tab, real 3-node PoA, 3D View

Two session runs. The first died mid-W3 (Freebuff session end) with files intact and nothing
committed; the second resumed from the on-disk state, re-verified every contract, and drove
everything to green. No work was redone — the resume started by diffing memory against `git status`
and the files themselves.

## W1 — HKO poller (PRD §5.2, S35–S40)

- Recon first: probed the real HKO endpoints from this sandbox before writing a line.
  `rhrread` has no wind; the territory wind lives in
  `https://data.weather.gov.hk/weatherAPI/opendata/opendata/latest_10min_wind.csv` (per-station
  10-min mean + gust); signals come from `warnsum` (`TC8NE`-style codes).
- `server/weather.py`: parsers for all three, 5-min TTL cache in `server/data/weather_cache.json`,
  `stale` + honest `ageS`, typhoon dispatch gate (Signal ≥ 8 refuses dispatch; a STALE snapshot
  blocks nothing — FR-W4), `wind_cost_factor` (S36 path-cost penalty), genesis `WEATHER` tx (S40)
  reading the cache only — a mint never waits on the network, and a missing cache is recorded as
  `snapshotHash: null`, never fabricated.
- `GET /api/weather`: snapshot + `dispatchBlocked` + `pathCostFactor` + `cachedSnapshotHash` +
  `genesisWeather` + `genesisMatchesCache`.
- `server/probe_weather.py`: 27 checks, ALL PASS, driven on a private port/state/cache so all
  four S-conditions are forced deterministically offline. Acid test: mutated the gate → exactly
  1 red → restored byte-exact (md5).

## W2 — real 3-node PoA topology (PRD §4.4, S3)

- `server/chain_node.py` (:8201–8203) and `server/agent_node.py` (:8101–8102) over
  `server/json_http.py` (stdlib `http.server`, no new deps). Per-PROCESS Ed25519 keys; the
  launcher is `python -m server.topology` (script-mode import paths were the one real bug).
- `server/main.py` requests REMOTE quorum signatures from the nodes and verifies against
  node-published public keys. If nodes can't deliver 3-of-3, boot fails — no silent local-key
  fallback. Single-process mode still works unchanged for dev/probes.
- `server/probe_topology.py`: 30 checks, ALL PASS — hostile-input boundary at the signing
  endpoint, quorum math, genesis across the topology. Acid test: forced a local-key fallback →
  8 red, chain honestly reported `QUORUM_INVALID` (it refuses to fake validity) → restored.

## W3 — 3D View tab + HKO weather tab (PRD §11.4, S104/S111/S126–S129)

- `src/services/cesiumLoader.ts`: CesiumJS 1.131 lazy CDN load, cached promise, timeout, honest
  rejection. No `npm install` (banned) — same CDN pattern as Mapbox.
- `src/components/three/cesiumScene.ts`: plain module (no React) taking the Cesium GLOBAL;
  RFZ volumes extruded 0–400 m (red/amber/cyan by kind), drones at real altitude with
  callsign+altitude labels, corridor polylines, dashed planned A* trail, weather cells with wind
  labels, skycell traffic volumes by band. Provider ladder implemented literally:
  **open3dhk → ion → osm**, each rung reported in a status line.
- `src/components/three/ThreeDViewPanel.tsx`: full-screen OVERLAY over the mounted 2D dashboard;
  single Exit button restores the exact section (S129, both roles). Layer toggles: shared ones
  (`drones/routes/restrictedZones/weather/grid`) write through to the SAME store flags the 2D map
  uses; `buildings/terrain/trails` are 3D-only. Terrain flips rebuild the scene (construction-time
  option in Cesium); everything else paints the live scene without rebuild. `buildings` disables
  itself with an explanation when no key exists — never a silent toggle.
- `src/components/panels/WeatherPanel.tsx` + `src/services/hkoWeather.ts`: renders the server's
  snapshot; offline it lists exactly which S-criteria are unverifiable instead of going blank, and
  retries every 5 s. `genesisMatchesCache` is shown honestly (drift after any refresh is expected).
- Navigation: `NavSection` gains `weather` (label "3D View", carrying both the Cesium scene and
  the HKO evidence panel). Sidebar S111: 7 → 8 operator entries, 10 admin. TopBar 3D button for
  both roles (S126 — shared, not per-role).

## Verification at commit time

- Gates: `tsc -b` 0 · `vite build` ✓ · `eslint . --max-warnings=0` clean · vitest **141/141
  (23 files)** — 13 new tests (threeDView 9, hkoWeather 4) against a fake Cesium global
  (`src/test/fakeCesium.ts`), operatorTabs count 7 → 8.
- Probes: probe_weather ALL PASS · probe_topology ALL PASS · probe_api ALL PASS ·
  probe_lifecycle 38 · probe_routes 42/42 · probe_m3_seam ALL PASS · ruff clean.
- Live browser (:4173 preview, :8000 API): 3D overlay builds a real scene (Cesium 1.131,
  3 RFZ volumes, 594 skycells, 2 drones, 3 routes, OSM tiles streaming); the weather toggle
  flips entity visibility through the real store; Exit returns to the 2D map; the Weather tab
  renders the live HKO snapshot (31 km/h Ngong Ping, gust 42, 28 °C, 80 %, ×1.26 cost factor,
  S38 gate open, S40 anchor matching the cache); sidebar 8/10; console clean.

## Lessons

- The `vi.mock` factory on `cesiumLoader` never intercepted: the REAL loader resolves instantly
  when a global `Cesium` exists, which made 7 of 9 tests pass for the wrong reason. Fix was to
  delete the mock and set the global to the fake — loader + builder get exercised together, and
  the failure case is driven through a global whose Viewer constructor throws.
- File tools cannot edit dotfiles here (`.env.example`): reads work, edits silently "don't
  exist". A surgical `python` one-liner did it.
- Resume-after-crash discipline paid: diff memory vs `git status` first, re-read only what you
  are about to change.
