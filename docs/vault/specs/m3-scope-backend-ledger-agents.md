---
type: Spec
status: draft
date: 2026-09-26
tags: [spec, m3, backend, ledger, agents]
related: ["[[m3-session-obsidian-memory-pipeline-items-1-5]]", "[[prd-defects-1-6-deferred-out-of-scope-this-session]]", "[[mapbox-sdk-loaded-via-cdn-because-npm-install-is-banned]]"]
---

# M3 scope - backend, ledger, agents

## Requirement source
- `docs/system_design.md` §1 (ordered milestones): "M3 Backend, ledger, agents: FastAPI APIs, Python LLM-agent negotiation, 3-node PoA ledger, blockchain-as-communication protocol."
- Resume point in `HANDOFF.md` §6.

## Requirement
- Implement the backend behind the existing `DataBackend` seam so the frontend can swap `mock` / `cad-geojson` for HTTP with no component changes.
- FastAPI services for fleet, missions, zones, weather alerts, auctions and approvals.
- Python LLM-agent negotiation for corridor and credit negotiation.
- A 3-node proof-of-authority ledger used as the communication substrate between agents.
- Persist auctions and approvals server-side — today they exist only in the in-memory Zustand store.

## Acceptance criteria
- [ ] The `DataBackend` interface in `src/services/dataBackend.ts` is implemented by an HTTP backend without changing the interface.
- [ ] Auction and approval state survives a server restart.
- [ ] A 3-node PoA ledger reaches consensus and exposes an auditable chain.
- [ ] Agent negotiation produces a recorded, replayable transcript.
- [ ] All four gates stay green (`tsc -b`, `vite build`, `eslint . --max-warnings=0`, `vitest run`).

## Current state
- **Not started.** No FastAPI, ledger or agent code exists.
- The seam is ready: `src/services/dataBackend.ts` defines `DataBackend` (`loadInitialState`, `loadZones`, `listZones(bounds)`, `loadFleet`, `loadMissions`, `loadWeatherAlerts`, `simulateTick` plus `id`/`label`/`offlineCapable`/`usesIngestedGeodata` metadata); two implementations live in `src/services/dataBackends.ts` (`mock`, `cad-geojson`).
- Frontend state is in-memory only (`src/store/dashboardStore.ts`).
- No longer blocked by the CAD data defects that would have poisoned M3 compliance checks — see [[CAD ring-order corruption broke RFZ containment]].

## Open questions
- Which store for persistence — SQLite, Postgres, or an in-repo JSON store for the demo?
- Is the PoA ledger demo-only (3 local nodes) or a real network?
- Should PRD defects 1-6 be folded into M3 or fixed first? See [[PRD defects 1-6 deferred out of scope this session]].

## Related
- [[m3-session-obsidian-memory-pipeline-items-1-5]]
- [[prd-defects-1-6-deferred-out-of-scope-this-session]]
- [[mapbox-sdk-loaded-via-cdn-because-npm-install-is-banned]]
