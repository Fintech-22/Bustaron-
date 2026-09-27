---
type: Progress
status: done
date: 2026-09-27
tags: [progress, orchestration, m3, negotiation, agents, s25, fr-n6, fr-n8, verification]
related: [b3-get-events-sse-and-machine-readable-event-type, m3-phase-2-3-of-3-proof-of-authority, step-0-r2-stabilize-uncommitted-increment]
---

# B4 — §8 negotiation engine: reviewed, wired, anchored on-chain (S25 → MET, S22 → MET)

## What was attempted

The run opened with the mandated **PHASE 1 current-state audit**, then executed the highest-value
remaining M3 item under a 2-agent sub-team protocol (Creator implements; Reviewer reviews the same
work in lockstep; Overseer signs off against the PRD).

The audit's headline: **`server/agents.py` — 895 lines implementing PRD §8 (FR-N1…FR-N8) — was
untracked, unwired, unprobed and untested.** It compiled and imported; nothing referenced it.
`.workbuddy-ai/b4/thread.md` held one word: `[BLOCKED]`. This is the fourth instance of the repo's
signature failure mode — a coherent increment no gate can see.

## What succeeded

### 1. Engine review — five defects, all fixed before the module was allowed near the chain

| # | Defect | Why it mattered |
|---|---|---|
| 1 | `ALTITUDE_YIELD` climbed when the drone was **below** its peer | The docstring's own intent is "the sign chosen to INCREASE vertical separation"; the code reduced it. Now one `yield_direction()` helper (up at-or-above, down below). |
| 2 | `build_proposal.to_alt_m` always advertised `+30` | The §8.5 envelope **lied about the effect** whenever the simulation moved the drone down. `proposal_to_alt()` now shares the direction rule, so advertised and simulated altitude cannot diverge. |
| 3 | `validate_envelope` compared a COUNTER against `payload["proposed"]` — a key no builder sets | Dead code: "COUNTER must offer an ALTERNATIVE" was **unenforced**. Replaced by pair-aware `validate_exchange()` (same `conflict_id`, swapped endpoints, ACCEPT echoes the proposal, COUNTER differs from it). |
| 4 | `build_resolution` silently attributed an unknown executor to the peer | A malformed resolution LOOKED well-formed. Now raises `ValueError`. |
| 5 | The LLM path derived `fallback` from prose (`detail.startswith("FR-N5")`) | Machine state from a human string. Replaced with an explicit flag; the LLM exchange is now validated as a pair and an invalid one falls back to the deterministic policy (FR-N8). |

### 2. `server/probe_agents.py` — pure-logic probe, no server required (new)

Checks FR-N1 (prediction), FR-N2 (both conflict legs, deterministic `conflict_id`), FR-N3 (proposer
selection, menu, cheapest-resolving choice, the fixed `+30` tie-break preserved), FR-N4 (all four
cross-message rules), FR-N5 (forced deadlock → REJECT + FR-N5), FR-N7 (measured **0.42 ms** mean per
exchange vs the 5 s budget), FR-N8/S21 (a killed endpoint falls back) and S23 (provider swap via
config only, with a stubbed `urlopen` — no key, no network).

### 3. Wiring — `POST /negotiate` + `GET /negotiations` (FR-N6 / S25 / S22)

- The engine's proposal, response and resolution are anchored as **three consecutive blocks, one per
  message**, before the caller sees anything, so "acted upon only after block confirmation" holds
  message by message. Each block is quorum-verified before `save_state()`; a failure pops it and 500s.
- A **conflict-free pair anchors nothing** — an empty exchange is not an event.
- `GET /negotiations` replays anchored exchanges from the chain, grouped by `conflict_id`, with
  `latencyMs` computed from **block** timestamps (the S22 evidence), never from envelope `ts_ms`.
- `NEGOTIATION` is **server-minted and deliberately not in `TXType`** (documented like `GENESIS`), so
  it cannot become the next advertised-but-rejected type. Probe asserts a client submission gets
  **422** from the schema, not a runtime 400.
- `server/main.py` is now **ruff-clean** (`ruff check server/` → 0; the 9 pre-existing `E501`s fixed).

## What failed / blockers (recorded because they are the point)

- The engine had **no tests, no probe and no caller**. Fixed here; the probe is 40 checks and is
  itself shown to discriminate (below).
- **Deferred, recorded not buried:** (a) `sig_drone` is still `""` — real per-drone signatures are
  M4/ESP32 work, and S18's "signed by the drone" cannot be met before it; (b) **client-submitted
  envelopes with on-chain pairing** (the strictest reading of S25) — the engine is the only producer
  for now; (c) live `NEGOTIATION_MESSAGE` frames on the SSE stream for the demo display (S31).
- The HKO poller (S35–S40) still does not exist, so every negotiation that carries no weather
  snapshot reports `weather_stale: true` — honest, but S37 cannot be met until the poller lands.

## Verification — the evidence discriminates

Frozen revisions, md5-checked: `server/agents.py` `71c1b216…`, `server/main.py` `9c2247d9…`.

| Check | Result |
|---|---|
| `tsc -b` · `vite build` · `eslint . --max-warnings=0` · `vitest run` | 0 · 0 · 0 · **128/128 (21 files)** |
| `python server/probe_agents.py` | **ALL CHECKS PASSED** |
| `python server/probe_api.py` (official runner, sole runner on `:8000`) | **ALL CHECKS PASSED, exit 0** (+14 negotiation checks) |
| `probe_lifecycle` · `probe_routes` · `probe_m3_seam` | ALL PASS · 42/42 · ALL PASS |
| **ACID TEST A** — old yield direction + `validate_exchange` neutered | **10 FAILED / exit 1** — incl. `to_alt_m=100.0 simulated=130.0` |
| **ACID TEST B** — anchor only the proposal block | **4 FAILED / exit 1** — `[2]`, `2 -> 3`, replay group empty |
| Restore integrity after both mutations | md5 byte-identical, probe green again |

**ACID TEST A is the load-bearing one:** it re-creates the exact original bugs and the probe names
each rule it protects. Both mutated revisions were restored byte-for-byte.

## Scope rulings (Overseer, against the PRD)

- **S17, S19, S20, S21, S22, S23 = MET** as engine/server behaviour. **S22 is MET by on-chain
  timestamps** (block span), not prose.
- **S18 = NOT MET** — the envelope is structurally correct but `sig_drone` is empty; blocked on the
  ESP32 key pair (S7), i.e. M4.
- **S25 = MET** for engine-produced exchanges (three anchored blocks, replay from chain).
  **PARTIAL by the letter** for drone-originated submissions — deferred and named.
- **S15 (agent reads genesis and parses its mission)** not attempted — no mission parser exists yet.
- `NEGOTIATION` not being in `TXType` is a deliberate design decision, not an oversight.

## Lesson worth keeping

The Reviewer's job is not to read the Creator's diff — it is to make the Creator's evidence fail on
purpose. Ten of the forty new checks exist because a defect was *found first* and the check was
written to catch it; both acid tests then re-created those defects and watched the suite go red. The
audit's most valuable output was not a task list — it was finding the orphaned module before it could
become a fifth unverified increment.
