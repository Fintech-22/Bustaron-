---
type: Decision
status: accepted
date: 2026-09-26
tags: [decision, prd, scope, m3]
related: ["[[m3-scope-backend-ledger-agents]]"]
---

# PRD defects 1-6 deferred out of scope this session

## Context
- Drift analysis (T1 in `TRACE.md`) compared the PRD and design docs against the implementation.
- Six genuine PRD-level defects were found — built wrong, not merely unbuilt:
  1. **Altitude bands wrong.** PRD FR-OP-V6/S109 needs 0-80/80-160/160-240/240-320/320-400 m. Code has a slider `min=80 max=220` (`src/components/panels/MissionPanel.tsx:124-125`) and a clamp `Math.min(250,…)` (`src/store/dashboardStore.ts:129`), so 320-400 m is unreachable and the control filters nothing.
  2. **No role-based map scope.** PRD §11.3.3 says an operator sees own drones only. `Drone` has no `operatorId`, and `TacticalMap.tsx:120` renders all drones for both roles.
  3. **Sandbox zones treated as no-fly.** PRD §5.3 says restricted = infinite cost, sandbox = high cost. All CAD features get `kind:'rfz'` (`cadGeoJsonService.ts:58`) and `routePlanner.ts:156-158` hard-blocks `rfz`.
  4. **Approvals missing a reason field** (PRD S121). `ApprovalsQueuePanel.tsx:39-44` has two buttons only; `reason` is read-only display.
  5. **KPI bars don't match the PRD** (S110/S117). `AppShell.tsx:62-65` shows Active drones / Mission load / Weather cells / Avg battery.
  6. **`AirspaceZone.kind` has no `'sandbox'`**, so the PRD's two-class taxonomy is unrepresentable.
- The user's requested scope for this session was items 1-5 (drift analysis, CAD fix, Mapbox, UI, memory pipeline) — none of which is one of the six defects.

## Options considered
1. **Fix all six this session** — expands scope beyond what the user asked and collides with in-flight UI work.
2. **Defer them, logged and linked, and fix in M3** — keeps this session's scope honest and makes the debt retrievable.
3. **Drop them silently** — rejected; they would simply be re-derived later.

## Decision
- Defer PRD defects 1-6 to M3, recorded in `TRACE.md` and in this vault, rather than fixing them in this session.

## Consequences
- **Positive** — session scope respected; the defects are now discoverable in seconds via [[Index]] and `bun tools/obsidian.mjs search`.
- **Negative / trade-offs** — the product still contradicts the PRD in six places; defect 3 in particular means sandbox zones are currently routed as no-fly.
- **Follow-ups** — schedule all six at the top of M3; defect 3 should land before any backend compliance logic is built on zone kinds.

## Who / when
- Decided by: team-lead (T1 in `TRACE.md`)
- Date: 2026-09-26

## Related
- [[m3-scope-backend-ledger-agents]]
