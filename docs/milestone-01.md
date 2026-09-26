# BUSTARON Milestone 1 — Frontend Tactical Shell

## What was built

Milestone 1 creates the first runnable shape of the BUSTARON web app: a mock-only frontend tactical operations dashboard. It focuses on the PRD requirement that the operational web app should land on a 2D dashboard, not a 3D scene.

The implementation includes:

- A Vite + React + TypeScript project scaffold.
- A dark tactical aviation UI for BUSTARON.
- Operator and Admin dashboard modes.
- A schematic 2D Hong Kong / Victoria Harbour operations map using SVG and CSS instead of external map APIs.
- Mock drone markers with altitude, heading, status, battery, operator ownership, and selection behavior.
- Mock route lines, RFZ overlays, airspace grid, and weather direction overlay.
- Layer toggles for drones, routes, RFZ, grid, and weather.
- Altitude band filters for the five PRD bands: 0-80m, 80-160m, 160-240m, 240-320m, and 320-400m.
- Operator navigation entries matching the PRD: Live Map, Flight Plans, Credit Wallet, ESG Scorecard, Fleet, Analytics, Alerts, and hidden 3D View.
- Admin navigation entries matching the PRD: System Dashboard, Airspace Management, Approvals Queue, Blockchain Audit, Counter-Drone, UAV Police, Operators, Analytics, Alerts, and hidden 3D View.
- Mock Admin widgets for approvals, blockchain audit, and counter-drone posture.
- Accessible controls using real buttons, `aria-pressed`, `aria-current`, visible focus states, semantic headings, and readable dark-theme contrast.

## Why this was built first

The full PRD is much larger than a single implementation pass. It includes a PoA blockchain, Python agents, ESP32 firmware, CesiumJS demo screens, HKO weather ingestion, RFZ processing, auctions, operational compliance, exports, analytics, and BVLOS workflows.

Starting with the frontend tactical shell is the safest first milestone because it establishes:

1. The visible product frame reviewers and demo users will understand first.
2. The role split between Operator and Admin.
3. The PRD's key UI decision: 2D map first, 3D hidden behind a tab.
4. Mock data contracts that future backend/API milestones can replace.
5. Accessibility and responsive UI foundations before the app becomes larger.

## How it works

The app currently uses mock data only.

- `src/types/domain.ts` defines the app's core domain models: drones, missions, airspace zones, weather alerts, metrics, roles, sections, map layers, and altitude bands.
- `src/data/mockData.ts` provides realistic Hong Kong tactical mock data.
- `src/services/mockDataService.ts` exposes a simple loading function and a simulation tick helper for future live movement.
- `src/store/dashboardStore.ts` owns the current role, active section, selected drone, enabled layers, altitude band, and emergency state.
- `src/components/layout/*` renders the shell, sidebar, and top bar.
- `src/components/map/*` renders the schematic tactical map, map controls, and selectable drone markers.
- `src/components/panels/*` renders status, mission preview, and admin widgets.
- `src/styles/globals.css` contains the dark tactical theme, responsive layout, map visuals, panels, focus states, and mobile behavior.

No backend, blockchain, live weather, real RFZ data, Mapbox, Leaflet, Cesium, or ESP32 code is included in this milestone.

## How to run

From the project folder:

```bash
npm install
npm run dev
```

Expected verification commands after dependencies install:

```bash
npm run build
npm run lint
npm run test
```

## Current verification status

Code files for Milestone 1 have been written, but dependency installation could not be completed in this turn. The local package manager repeatedly stalled while unpacking `node_modules`, with errors like:

```text
npm warn tar TAR_ENTRY_ERROR ENOENT: no such file or directory
[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]
```

The failure is environmental/package-install related, not a known source-code failure. I stopped the install attempts instead of repeatedly retrying. The next step is to retry dependency installation after the file-operation guard resets, then run build, lint, and tests.

## Out of scope until later milestones

- Real Mapbox/Leaflet integration.
- CesiumJS / Open3Dhk 3D scene.
- Live HKO weather ingestion.
- LandsD/CAD RFZ GeoJSON loading and point-in-polygon checks.
- A* flight planning.
- Credit auction and smart tolling.
- FastAPI backend.
- PoA blockchain.
- LLM agent negotiation.
- ESP32 firmware or LCD display code.
- Authentication, persistence, exports, customer portal, analytics, and BVLOS scheduling.
