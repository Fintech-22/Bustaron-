---
type: Progress
status: done
date: 2026-09-27
tags: [progress, orchestration, m3, sse, events, tamper-detection, s4, s6, verification]
related: [step-0-r2-stabilize-uncommitted-increment, m3-phase-2-3-of-3-proof-of-authority, settle-and-file-endpoints]
---

# B3 — `GET /events` SSE + machine-readable event type (S4 → MET, S6 → MET)

## What was attempted
Close the **one** north-star bullet held below MET. The audit held **S4 at PARTIAL** for exactly one
reason, verbatim: *"`GET /events` (S6) is unimplemented and the durable record carries no
machine-readable event type, so `TAMPER_DETECTED` is selectable only by string-matching prose. A log
line is not a delivery surface."* Backend/technical first, per STEP 2.

Run as a real hierarchy: Overview (persistent) → Supervisor (1/task) → Worker (1) + **paired
Reviewer running concurrently, not after**. Peer discussion in `.workbuddy-ai/b3/thread.md`.

## What succeeded
- **`ChainFault`** (`code` + `height` + prose) replaces the bare fault string, so the single detection
  point emits a stable token: `STATE_FILE_UNREADABLE` / `BLOCK_LINK_BROKEN` / `BLOCK_HASH_MISMATCH` /
  `QUORUM_INVALID`. Durable records are now
  `{id, type:"TAMPER_DETECTED", atMs, source, faultCode, height, fault}`.
- **Legacy records upgraded ON READ** (`_event_envelope()`), never by rewriting the evidence file —
  consistent with the existing rule that a corrupt file is reported, never re-seeded or overwritten.
- **`GET /events`** — `StreamingResponse(text/event-stream)` over an async generator: replays durable
  history, emits an SSE comment frame `: replay-complete` as an **exact** history/live boundary, then
  streams live. Fan-out via `EventBroker`, crossing from the sync `submit_tx` threadpool into the loop
  with `loop.call_soon_threadsafe`; guarded no-op when no loop is bound (import-time path). SSE `id:`
  field + best-effort `Last-Event-ID` resume; stream documented **at-least-once**. No new dependencies.
- **Round 1 was REJECTED** — and that is the most valuable thing that happened.

## What failed / blockers (recorded because they are the point)
- **The probe's live assertion was a proven false green.** It read only 1 frame at connect while the
  replay buffer held the whole durable history, so a *buffered replay frame* satisfied the live check.
  With `EventBroker.publish()` replaced by an early `return` — live delivery completely dead — the
  official probe still printed `ALL CHECKS PASSED`. The **Reviewer found it by experiment**; the
  **Supervisor reproduced it independently** before accepting the finding.
- **The Worker's own first fix also failed**, and it said so unprompted. A `select()`-based drain did
  not discriminate: a late subscriber's whole replay arrives in one TCP segment and the first
  `readline()` buffers it, so the kernel socket looks empty. A socket-timeout variant poisons the
  stream (`OSError: cannot read from timed out object`). The shipped boundary is therefore **exact,
  not timing-based**.
- **Probe-side flakiness, root-caused:** `HTTPResponse.close()` often sends no FIN, so a subscriber
  was released only at the 15 s keep-alive (measured 0.0 s vs 15.5 s), making the leak assertions
  racy. `EventStream.close()` now shuts the socket down. 3/3 frozen-revision runs green afterwards.
  **Honest limit:** three clean runs is not proof that flakiness is absent.
- **Round 1 shipped no plan**, so the Reviewer could only review code. Corrected in round 2 (plan
  posted to the thread before implementing).

## Verification that the evidence actually discriminates
Verified **by the Supervisor, by running**, on a revision frozen and md5-checked before and after
every mutation (`main.py` `d21079a3…` LF-only; `probe_api.py` `f3f55d2d…`):

| Check | Result |
|---|---|
| Green baseline, official probe, sole runner | **92 PASS / 0 FAIL / EXIT=0** |
| **ACID TEST** — live delivery dead | **6 FAILED / EXIT=1** — exactly the six live assertions; the other 19 S6 lines still PASS |
| Idempotency (3 runs, label sets diffed) | **92/92/92, sets identical** |
| Reviewer's flakiness concern | **PASS 3/3** |
| `tsc` · `eslint` · `vitest` | 0 · 0 · **128/128 (21 files)** |
| `probe_lifecycle` · `probe_routes` · `probe_m3_seam` | PASS · 42/42 · **7/7** |
| **Real browser `EventSource`** — the gap *both* agents flagged as unverified | `onopen` fired, `err: null`; after a 409 the browser received the **live** event `{type:"TAMPER_DETECTED", faultCode:"BLOCK_HASH_MISMATCH", height:1}` |

## Scope rulings
- **S4 = MET** and **S6 = MET** (all three legs: `/chain`, `/block/{height}`, `/events`).
- The `: replay-complete` boundary assertion is **load-bearing — do not relax it**. Recorded so a
  future tidy-up cannot silently remove it.
- **Deferred, recorded not buried:** the invisible `MAX_TAMPER_EVENTS=100` truncation marker, and the
  blocking `load_state()` on the event loop inside `events()`.

## Lesson worth keeping
**A green probe is not evidence until you have watched it go red.** The single highest-value move of
this task was breaking the feature on purpose and confirming the test noticed. The paired-Reviewer
role earned its place: it caught, by experiment, the one thing that mattered — and the Worker's
honest disclosure that its own first fix failed is what made the second round trustworthy.
