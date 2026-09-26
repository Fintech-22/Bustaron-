---
type: Session
status: done
date: 2026-09-26
tags: [session, m3, ui, verification]
related: ["[[PRD defects 1-6 deferred out of scope this session]]", "[[CAD ring-order corruption broke RFZ containment]]", "[[Mapbox SDK loaded via CDN because npm install is banned]]"]
---

# T8 resume session - drift audit, mobile disclosure, provider default

## Session goal
- Execute the ordered resume protocol: (1) re-read PRD + milestone-01 + TRACE + system design and diff against implementation BEFORE writing code; (2) apply UI-frontend-engineering standards; (3) decompose into smallest tasks and verify behavior — not just compilation — via gates, headless probes, and the live preview.

## What was done
- **Step 1 — drift audit (no code first).** Re-read the PRD (904 lines, S1–S129), both milestone docs, `system_design.md`, `HANDOFF.md`, TRACE T0–T7 and the vault. Re-verified T1's findings against current code: PRD defects 1–6 all still open (altitude clamp 250, no `operatorId`, no sandbox kind, approvals reason read-only, M1 KPI labels, no sandbox taxonomy); design drift (MUI/lucide absent) unchanged. The two open *UI* defects from T7 became this session's scope.
- **T7-3 mobile hierarchy — FIXED.** `SidebarNav` collapses the section list below 768px behind a `Menu` disclosure (`aria-expanded`, `aria-controls`, collapse-on-navigate); toggle hidden ≥768px where the nav rail is permanent. Closed the dangling uncommitted `useState` import left by the interrupted prior session.
- **C6 empty-Mapbox default — FIXED (stopgap).** `MapHost` defaults to offline-svg even with a token; added a labelled provider toggle (Mapbox disabled with explanatory title when no token). Mapbox still renders no tactical overlay — the overlay migration remains open.
- **NEW finding — Victoria Harbour RFZ seals mid-harbour transits.** Compliance-correct with the corrected 284-zone pack: 38/42 endpoint pairs route; the 4 failures are exactly Central pier ↔ {Kwun Tong, Lei Yue Mun}. The old 42/42 claim was an artifact of the pre-T2 corrupt rings. Default demo destination changed to Stonecutters west; the refusal is now asserted as a feature.
- **Seed fix.** Wallet `reservedCredits` now mirror seeded open bids AND escrowed approvals (urban 260/80, cargo 640/160) — rejecting an approval could previously drive reserved negative.

## Artifacts produced
- `src/components/layout/SidebarNav.tsx` (disclosure), `src/styles/globals.css` (topline/collapsed/toggle rules + specificity fix)
- `src/components/map/MapHost.tsx` (default + toggle), `src/components/map/MapboxMap.tsx` (comment only)
- `src/data/mockData.ts` (seed invariant), `src/components/panels/MissionPanel.tsx` (default dest)
- `src/test/MapHost.test.tsx` (rewritten, 4 tests), `src/test/navDisclosure.test.tsx` (NEW, 3 tests)
- `scripts/probe_lifecycle.ts` (NEW — full store lifecycle probe), `scripts/probe_harbour.ts` (NEW — transect diagnostic)
- `TRACE.md` T8 entry; this note + regenerated `Index.md`

## Verification
<!-- Exact commands run and their results. Evidence, not claims. -->
- `bun scripts/probe_lifecycle.ts` → **28/28 PASS, exit 0** (init, mock+CAD planning, explicit sealed-crossing refusal, bid escrow 90, below-reserve rejection, award refunds, settle transfers 120 to corridor owner, approve burns / reject refunds, ledger rows, backend seam).
- Four gates via direct bun binaries: `tsc -b` 0 · `eslint . --max-warnings=0` 0 · `vite build` 0 · `vitest run` **71/71** (was 66).
- Live preview (vite preview on 127.0.0.1:4173, `register_preview`, snapshot/evaluate): disclosure display/aria transitions; provider toggle MAPBOX↔SVG both ways (mapbox `data-mapbox-state=ready`); route planned 6.5 km / 10 waypoints with cyan polyline; CAD-source refusal renders `role="alert"`; 1440px tier — toggle hidden, nav rail, 4-col KPIs, 2-col dashboard. `preview_logs` console: zero errors.
- Preview-env note: this preview browser does not deliver trusted clicks; interactions were driven via the React props handlers (same code path as a click), asserting store/DOM state after each step.
- Caught live and fixed: a first CSS fix left the toggle visible at 1440px (later `.control-button` rule beat the media query) — gates were green while it was visible. Only live inspection caught it.

## Open threads for the next agent
- PRD defects 1–6 remain open ([[PRD defects 1-6 deferred out of scope this session]]) — the first real M3 product work.
- Mapbox overlay migration (zones/drones/routes on the Mapbox path) — the provider toggle is a stopgap, not the fix.
- M3 backend itself not started: see the m3 scope note; `DataBackend` is the seam.
- `npm run` path has still never been executed (C5).

## Read next
- [[PRD defects 1-6 deferred out of scope this session]]
- [[CAD ring-order corruption broke RFZ containment]]
- [[M3 scope - backend, ledger, agents]]

## Related
- [[Mapbox SDK loaded via CDN because npm install is banned]]
