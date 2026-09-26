---
type: Session
status: done
date: 2026-09-26
tags: [session, m3, fastapi, ledger, prd]
related: ["[[M3 scope - backend, ledger, agents]]", "[[PRD defects 1-6 deferred out of scope this session]]"]
---

# T11 defects closed and M3 phase 1 fastapi ledger

## Session goal
- Close the remaining PRD defects (2/3/6), then start M3: the FastAPI backend behind the frontend's `DataBackend` seam, per the PRD §4.4 `server` role.

## What was done
- **Defect 6 (taxonomy).** `services/zoneClassification.ts` classifies sandbox zones from the CAD pack's name designation — 24 sandbox / 260 rfz of 284; domain `kind` union extended with `'sandbox'`.
- **Defect 3 (sandbox costs).** `routePlanner` penalises sandbox transit ×2.5 (`SANDBOX_COST_FACTOR`) instead of blocking; only `rfz`/`sensitive` remain infinite-cost. Consequence: "Victoria Harbour (Low-altitude Economy Regulatory Sandbox)" reclassified, so Central↔Kwun Tong now routes; the sealed-crossing assertion moved to a synthetic rfz-band test.
- **Defect 2 (scoping).** `Drone.operatorId` + `currentOperatorId` in the store + operator impersonation select in the top bar; operator console sees own fleet, admin sees all — enforced on both map providers, fleet-scope readout in the meta row.
- **M3 phase 1.** `server/main.py`: FastAPI (0.141.1) + uvicorn (0.54.0, pip --user). Hash-chained append-only ledger (`/chain`, `/block/{height}`, chainValid recomputed per read), server-persisted wallets/auctions/approvals/ledger in `server/data/state.json` (atomic writes, seed-on-boot), `POST /chain/tx` for AUCTION_BID/AUCTION_AWARD/APPROVAL_DECIDE with client-parity rules (escrow, reserve→422, mandatory rejection reason→422, double decision→409), `/api/zones` serving the same CAD pack, CORS restricted to localhost origins. Frontend: `M3Backend` (`m3-server`) with optional async `hydrate()` and graceful offline fallback.

## Artifacts produced
- `server/main.py`, `server/probe_api.py`, `server/data/state.json` (runtime)
- `src/services/zoneClassification.ts`, `m3Backend.ts`; updated `dataBackend(s).ts`, `routePlanner.ts`, `cadGeoJsonService.ts`, `dashboardStore.ts`, `TopBar.tsx`, both maps, `domain.ts`, `mockData.ts`
- `src/test/defects.test.ts` (NEW, 7), updated planner/CAD/probe suites; `scripts/probe_m3_seam.ts` (NEW)

## Verification
<!-- Exact commands run and their results. Evidence, not claims. -->
- Gates: `tsc -b` 0 · `eslint . --max-warnings=0` 0 · `vite build` 0 · `vitest run` **93/93** (14 files).
- `bun scripts/probe_lifecycle.ts` → **36/36** (sandbox taxonomy/scoping added).
- `python server/probe_api.py` → **22/22 PASS**: lifecycle + escrow math + error contracts + chain linkage + **tamper detection** (corrupted block → chainValid false) + **restart persistence** (identical state after kill/restart).
- `bun scripts/probe_m3_seam.ts` → **7/7**: store → server tx → chain anchor → re-hydrate → store shows persisted escrow.
- Live UI (127.0.0.1:4173): source picker shows `M3 server · chain h=4` with real server wallets; a UI bid was accepted and anchored (last block AUCTION_BID, chainValid true); console clean.
- Lesson: bun's fetch ignores CORS; browsers don't — the live UI caught the missing CORSMiddleware that both headless probes missed.

## Open threads for the next agent
- M3 remaining: LLM agent negotiation (§8), 3-node PoA multi-signer consensus (§9), ESP32 telemetry feed, HKO weather poller, settle endpoint, WebSocket `/events`.
- Server drones/missions are still mock-composed client-side; move them server-side next.
- `npm run` has still never been executed (C5).

## Read next
- [[M3 scope - backend, ledger, agents]]
- [[PRD defects 1-6 deferred out of scope this session]]

## Related
- [[Mapbox SDK loaded via CDN because npm install is banned]]
