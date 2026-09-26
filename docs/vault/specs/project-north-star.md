---
type: Spec
status: active
date: 2026-09-27
tags: [spec, north-star, orchestration]
related: [m3-scope-backend-ledger-agents]
---

# BUSTARON v3 — Project North Star

Source of truth: `BUSTARON_PRD.md` (§1, §3, §4.3, §11.4, §17). The PRD's own stopping
condition is that **all 129 criteria (S1–S129) pass and verify green**; nothing below may
be traded away to make a lower-value item look finished.

The six things that must NOT be broken for this project to succeed:

1. **The chain is the communication channel, not a database behind a REST API.**
   Drones read their mission from the chain and act only on *confirmed* blocks; proposals,
   responses and resolutions are transactions (§1.2 steps 5–7, §4.3 rule 5, S24–S26).
   *Falsifiable:* a negotiation that reaches resolution without a confirmed on-chain block
   is a failure, even if the UI shows success.

2. **Tamper-evidence is real and multi-signed.** Blocks carry **3-of-3 authority
   signatures** (Admin + Agent-A host + Agent-B host), and corrupting any historical block
   raises `TAMPER_DETECTED` within one append cycle (§4.3 rule 2, §9.1, S3–S4).
   *Falsifiable:* a single-process hash chain with no signatures is a **stepping stone**,
   not the destination — S3 stays NOT MET until 3-of-3 is enforced.

3. **The blockchain is never in the real-time control path; L2 on the ESP32 is sovereign.**
   With the chain, the agents, or the LLM killed, the mission does not pause and does not
   deadlock; proximity < 75 m or entry into a *restricted* RFZ forces HOLD regardless of
   negotiation state (§4.3 rules 1 & 3, S12, S20–S21, S26, S89).
   *Falsifiable:* any test where a chain/LLM outage stops the drone is a failure.

4. **2D is the landing page for BOTH roles; 3D is a hidden tab.** Operators and admins land
   on the dark 2D Mapbox/Leaflet HK map with their sidebar; the CesiumJS 3D scene is reached
   only via the "3D View" tab and exits back to 2D (§1.1, §11.4, G4, S104, S116, S126–S129).
   *Falsifiable:* a default 3D landing view violates the primary-workflow decision.

5. **Every operational record is anchored on-chain.** Flight plans, flight logs,
   maintenance, training, incidents and negotiations exist as on-chain transactions, not as
   client mock data sitting beside an empty API (§3 G2, §13–§16, S54/S56/S59/S63, S72).
   *Falsifiable:* `/api/fleet`, `/api/missions`, `/api/ledger` returning empty arrays while
   the UI shows mock data is a PARTIAL, not a pass.

6. **The end-to-end demo runs clean three times.** Genesis dispatch → flight → crossing
   conflict → on-chain negotiation → resolution → reroute → landing → final block, plus the
   tamper test (S88) and the L2 kill test (S89) (§17.13, S87–S90).
   *Falsifiable:* one clean run is not three; S90 requires three consecutive.

## How to judge this orchestration run

The load-bearing claims above — (1), (2) and the M4 hardware/3D showpiece (§1.1) — are the
parts that make BUSTARON *BUSTARON*. As of `8a584fc`/STEP 0 they are at or near zero while
M3 phase-1 ledger plumbing is green. Progress is measured by movement toward (1)–(6), **not**
by how much backend surface area is added. Legitimate cleanup (e.g. the M3 phase-2 backlog in
`docs/milestone-03.md`) must not crowd out the showpiece or the communication-channel core.
