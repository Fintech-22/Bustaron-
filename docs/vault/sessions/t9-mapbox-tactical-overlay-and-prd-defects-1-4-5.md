---
type: Session
status: done
date: 2026-09-26
tags: [session, m3, mapbox, prd]
related: ["[[Mapbox SDK loaded via CDN because npm install is banned]]", "[[PRD defects 1-6 deferred out of scope this session]]"]
---

# T9 mapbox tactical overlay and prd defects 1-4-5

## Session goal
- User direction: "actual restricted flying zones and drones, skycells shown on the mapbox itself — no need for the offline SVG", then continue further PRD milestones/tasks. Scope chosen: full Mapbox tactical overlay (C6 resolved), plus PRD defects 1 (altitude bands), 4 (approvals reason), 5 (KPI bars).

## What was done
- **Mapbox overlay (C6 RESOLVED).** `MapboxMap` now renders on the dark-v11 basemap: skycell grid (462 deterministic ~600 m cells, occupancy bands per FR-OP-V4), RFZ/sandbox/sensitive/heliport polygons (restricted red / sandbox amber per FR-OP-V3), weather cells, mission routes, planned A* route (dashed cyan), selectable drones (heading arrows via addImage SDF-style + status dots + callsign/altitude labels). Layer toggles + new altitude-band buttons drive both providers from the same store flags. `MapHost` defaults to `mapbox` with a token; offline SVG = no-token fallback + toggle option.
- **PRD defect 1 (S109).** `services/altitudeBands.ts`: five canonical bands 0–400 m; band filter buttons on both maps; `altitudeFilterM` filters markers on both providers; 250 m store clamp removed (now 400). Band edges inclusive on both ends.
- **PRD defect 4 (S121).** `decideApproval(..., reason?)` — rejection without a non-blank reason throws; reason recorded on the request and ledger row. UI: per-request input, Reject disabled until filled, inline `role="alert"`.
- **PRD defect 5 (S110/S117).** Role-based KPI bars: operator = Active Drones / Credits Balance / ESG Score / Pending Alerts; admin = Active Drones / Blockchain TPS (honest M3 placeholder) / City Risk Score / Pending Approvals.

## Artifacts produced
- `src/services/skycells.ts` (NEW), `src/services/zoneGeoJson.ts` (NEW), `src/services/altitudeBands.ts` (NEW)
- `src/components/map/MapboxMap.tsx` (full overlay), `MapHost.tsx` (default flip), `AltitudeBandControls.tsx` (NEW), `TacticalMap.tsx` (band filter)
- `src/store/dashboardStore.ts` (altitudeFilterM, setAltitudeFilter, 400 m clamp removal, reason passthrough), `src/services/creditsService.ts`, `src/types/domain.ts` (+`decisionReason`), `src/types/mapbox.d.ts` (extended)
- `src/components/layout/AppShell.tsx` (role KPIs), `src/components/panels/ApprovalsQueuePanel.tsx` (reason input), `globals.css` (approval-reason styles)
- Tests: `skycells.test.ts` (NEW, 4), `prdKpi.test.tsx` (NEW, 10), `creditsService.test.ts` (+reason contract), `MapHost.test.tsx` (new default)
- TRACE §T9; this note + Index

## Verification
<!-- Exact commands run and their results. Evidence, not claims. -->
- Gates: `tsc -b` 0 · `eslint . --max-warnings=0` 0 · `vite build` 0 · `vitest run` **86/86** (13 files).
- `bun scripts/probe_lifecycle.ts` → **33/33 PASS** (added: bands 0–400, clamp removed, `droneInBand` edges, skycell determinism, reject-reason refusal + recorded reason).
- Live preview (127.0.0.1:4173, rebuilt dist): via `window.__bustaronMap` + `queryRenderedFeatures` — mock source: 3 zones / 462 skycells / 8 drones / 3 routes rendered; CAD source: **110 restricted RFZ polygons rendered** with real names; planned A* route line rendered after planning; altitude band buttons = All + 5 with `aria-pressed`; operator KPIs = [Active drones, Credits balance, ESG score, Pending alerts], admin KPIs = [Active drones, Blockchain TPS, City risk score, Pending approvals]; approvals reason input present, Reject disabled without reason; `preview_logs` console clean.
- Gotcha recorded: Mapbox legacy `{property, stops}` paint object silently rendered zero features — the expression form `['match', ['get', …], …]` works. Also: preview screenshots fail with "webview not composited" once WebGL is live; programmatic map-handle assertions are the evidence path.

## Open threads for the next agent
- Remaining PRD defects: 2 (per-operator drone scoping), 3 (sandbox cost model in planner), 6 (zone kind taxonomy in the CAD pack).
- M3 backend behind `DataBackend` (FastAPI, PoA ledger, agents, persistence) — replaces the in-memory store and the TPS placeholder KPI.
- Mapbox screenshot capture still blocked by the compositing issue; if vision evidence is needed, use the model-routing policy.

## Read next
- [[Mapbox SDK loaded via CDN because npm install is banned]]
- [[PRD defects 1-6 deferred out of scope this session]]

## Related
- [[CAD ring-order corruption broke RFZ containment]]
