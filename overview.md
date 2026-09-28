# T14 — Full-HK Skycells + Risk Scoring + Admin Closure + A* Risk Routing + RFZ Visibility

## What was done

Implemented four user-requested changes to the BUSTARON drone airspace platform:

1. **Skycells extended to all of Hong Kong** — the grid now covers the full HK bbox (22.15–22.60°N, 113.82–114.52°E) with 500m cells (~12,800 cells). Previously only covered core HK with 600m cells.

2. **Risk scoring formula** — each skycell now has a risk score (0–100) computed from:
   - Wind speed (40% weight, normalized against 80 km/h)
   - Drone occupancy (30% weight, normalized against 6 drones)
   - Population density (30% weight, normalized against 50,000/km²)
   - Closed cells pinned to 100; RFZ-crossed cells clamped to ≥90
   - Static HK population raster from Census 2021 district data (13 tiles)

3. **Skycell click detail + admin closure** — clicking a skycell on the 2D Mapbox map opens a detail panel showing: area, wind speed, temperature, drone occupancy %, risk score with classification (low/medium/high/critical), population density, and closed status. Admins can close/reopen cells. Closed cells appear visually distinct (dark indigo) and block operator flight plans.

4. **A* planner uses skycell risk** — the route planner now weights step costs by skycell risk (higher risk = more expensive), avoiding high-risk areas when alternatives exist. Routes through closed cells are rejected with an error naming the blocked cell IDs.

5. **RFZ visibility improved** — raised fill opacity and line width for restricted zones on both 2D Mapbox and 3D Cesium maps. Added zone name labels on the 2D map. 3D RFZ volumes have higher alpha (0.42) and thicker outlines.

## Files changed

| File | Changes |
|------|---------|
| `src/services/skycells.ts` | Full rewrite: extended HK bounds, 500m cells, risk formula, weather/population/wind data, closed-cell state |
| `src/services/routePlanner.ts` | A* accepts skycells + closedCells; risk-weighted cost; closed-cell rejection |
| `src/store/dashboardStore.ts` | `closedCells` Set state + `toggleCellClosure` action; `planDraftRoute` passes skycells |
| `src/components/map/MapboxMap.tsx` | Skycell click handler + detail panel; admin close/reopen; closed-cell styling; RFZ opacity/labels |
| `src/components/map/TacticalMap.tsx` | RFZ stroke width increased; sensitive zone color |
| `src/components/three/cesiumScene.ts` | Closed skycell volumes (dark purple, 200m); RFZ alpha/outline improved |
| `src/components/three/ThreeDViewPanel.tsx` | Passes weatherAlerts + closedCells + RFZ polygons to buildSkycells |
| `src/styles/globals.css` | 128 lines: skycell detail panel styles |
| `src/test/skycells.test.ts` | Rewritten for new API: 7 tests (was 4) |

## Verification gates

| Gate | Result |
|------|--------|
| tsc | 0 errors |
| eslint | 0 errors |
| vite build | 0 errors |
| vitest | **144/144** passed (3 new tests) |
| pytest | 131/131 passed |
| ruff | 0 errors |
