---
type: Progress
status: done
date: 2026-09-27
tags: [progress, orchestration, s91, pytest, testing, verification, m3]
related: [b4-negotiation-engine-wired-and-anchored, t12-hko-weather-tab-3node-poa-3d-view, step-0-r2-stabilize-uncommitted-increment]
---

# S91 — the pytest suite (131 tests)

## What was attempted
Resume the remaining M3 items in priority order. On arrival HEAD was `519a470` (T12), two commits
past this agent's own last record (`aa6d51d`), with a 976-line `server/agents.py` it had never
written already committed by `a42cb73`. So the first act was a STEP 0-style re-verification **by
running**, not by reading commit messages.

Run 3's close-out named the two largest untouched non-M4 gaps: **S91 (pytest suite)** and the 3D
tab. T12 delivered the 3D tab. **S91 was therefore the next priority** — and it is pure addition,
so it cannot destabilise a verified revision.

## Blocker (flagged, not worked around silently)
**The account hit a hard credit limit (`429 Credits exhausted`) when the Worker sub-agent was
spawned.** The sub-agent was created and died before producing anything, so the mandated
Worker/Reviewer hierarchy could not be used for this task. This is recorded because it changes
what the evidence is worth: **there was no independent Reviewer for this increment.** The
compensating control was the discrimination experiment below — a stronger check on the *tests*
than a second reader, but **not** a substitute for independent review of production code. No
production code changed, which bounds the exposure.

## What succeeded
**`tests/` — 131 tests, 6.6 s, all green.** S91 asks for ≥ 60.

| Module | Tests | Covers |
|---|---|---|
| `test_agents_engine.py` | 54 | FR-N1..N8 at the level of `server/agents.py` alone |
| `test_chain_integrity.py` | 43 | FR-B4/B5/B6: hashing, linkage, quorum, tamper, state file |
| `test_api_contracts.py` | 34 | every HTTP endpoint, status codes, error contracts |

Plus `tests/conftest.py`, `tests/helpers.py`, `pytest.ini`, `requirements-dev.txt`.

**Isolation is the load-bearing design decision.** `DATA_DIR`/`STATE_PATH` are derived from
`BUSTARON_DATA_DIR` **at import time**, so `conftest.py` sets it *before* importing the app and
drives the API in-process via `TestClient` — **no port is bound**, so the suite can never race
`server/probe_api.py` for `:8000` or `server/data/state.json`.

## What failed / was corrected (two non-obvious properties, now documented)
1. **Seeding is IMPORT-TIME only.** Blanking `state.json` to `{}` and calling a *read* endpoint
   does **not** re-seed — only `submit_tx` and `POST /negotiate` call `seed_if_empty`, plus the
   module-level call at import. The first `client` fixture blanked the file and every
   seeded-table assertion failed against empty state. `probe_api.py` escapes this only because it
   **restarts the server** after blanking, which re-runs the import. The fixture now rebuilds the
   seed explicitly.
2. **`TestClient` cannot consume `/events`.** Reading the SSE stream in-process **deadlocks the
   whole session** (measured — hung until an external timeout killed it); the portal cannot cancel
   an infinite async generator. The suite asserts the route is registered and delegates wire
   semantics to `server/probe_api.py` (25 S6 assertions over a real socket). Asserted deliberately
   rather than left as an unexplained gap.

## Discrimination experiment (the compensating control)
A green suite is not evidence until it has been watched going red. Two mechanisms were broken in
`server/agents.py` — deliberately **the exact defects run 3 had to fix**:

| Mutation | Failures |
|---|---|
| `yield_direction` → always `1.0` (restores the pre-B4 "climb while below the peer" defect) | **2** |
| `conflict_id_for` salted with `time_ns()` (breaks FR-N2 determinism) | **4** |
| consequence: negotiation no longer reproducible | **1** |

**7 failed / 124 passed, exit 1.** Restored with `cp` from a byte-exact backup → md5
**`71c1b2166ef5af6d8507fe718bbece27`**, which **matches the md5 recorded in run 3's B4 review**,
independently confirming the frozen revision is the reviewed one. `git status server/` clean,
0 mutation markers, 131 passed again.

## Verification
`pytest` **131 passed** · `tsc` 0 · `eslint` 0 · `vitest` **141/141 (23 files)** ·
`ruff check server scripts tests` **0 errors** · `probe_agents` ALL PASS · `probe_lifecycle` ALL
PASS · `probe_routes` 42/42 · **`probe_api` 108 PASS / 0 FAIL / exit 0**.

## Honest scope limit
**S91 is MET for the five areas it names that exist** — chain, agents, negotiation state machine,
tamper detection, API endpoints. It is **NOT MET for equipment, maintenance, training and flight
logs**: those features do not exist yet (M5). The suite cannot cover code that was never written,
and claiming otherwise would be the exact overstatement this run exists to catch.

## Open findings recorded (not fixed — out of scope)
- **`llm_config_from_env()` does not strip the API key.** A whitespace-only key counts as
  configured, so the LLM path is attempted, fails auth, retries twice, then falls back — burning
  up to 4 s of FR-N7's 5 s budget for the same deterministic answer. Bounded (never deadlocks, per
  FR-N8) but real. Pinned by an explicit **characterization test**, not a silent pass. One-line
  fix: `(os.environ.get(...) or "").strip() or None` (the frontend already trims the analogous
  `VITE_MAPBOX_TOKEN`). Not applied because `server/agents.py` is a separately reviewed artifact.
- **§8.5 example vs implementation:** the spec example writes `"from": "drone:A"`; the engine
  writes the bare id (`"B"`). Self-consistent (replay groups by `conflict_id`), so a divergence
  rather than a defect — pinned in the test that would otherwise have asserted the example
  literally.

## Next
M3 phase-2 remaining: HKO weather poller refinements, the server-side simulation tick, ledger
coverage for `placeBid`/`fileApprovalRequest`, and the **PRD S1–S129 matrix re-score** (still not
done since `8a584fc`; several criteria have closed since). Then M4 (ESP32 + Cesium) — note S5
(60 s Merkle telemetry anchoring) and S18 (`sig_drone`) are both blocked on ESP32 key material.
