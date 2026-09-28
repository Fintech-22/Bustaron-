# PRD Status Review — S1–S129

**Repo:** `C:\Users\user\WorkBuddy AI\2026-09-24-21-39-57` @ git `d4ba385` (`main`)
**PRD:** `C:\Users\user\WorkBuddy AI\2026-09-20-21-42-04\BUSTARON_PRD.md` §17 (904 lines, 129 criteria)
**Date:** 2026-09-27
**Author:** orchestration lead (re-scored from `.workbuddy-ai/verification/ws-d-prd-conformance.md`, which was scored at `8a584fc`)

---

## 0. On "priority level"

**The PRD states no per-criterion priority.** §17 opens with: *"129 criteria total (S1–S129). No criterion is optional. No criterion may be skipped. The loop ends only when every item passes."* Every criterion is therefore **P0 / mandatory** by the PRD's own declaration.

The only priority signal in the PRD is **sequencing**, expressed through the milestone roadmap (M1 → M6) and the FR-* requirement numbering. I use that as the ordering key below:

| Ordering key | Meaning |
|---|---|
| **P0 — in scope now** | Belongs to M1–M3, the milestones the repo has actually started. |
| **P1 — later milestone** | Gated behind M4 (ESP32/Cesium), M5 (ops platform) or M6 (BVLOS). Not started. |
| **P0-BLOCKED** | P0 in scope, but cannot complete until an upstream item lands. Named dependency. |

---

## 1. Verdict key

| Verdict | Meaning |
|---|---|
| **MET** | Implemented and evidenced in source (file cited) or by a live command. |
| **PARTIAL** | Part is implemented — the implemented part and the missing part are both named. |
| **NOT MET** | In the PRD, in current milestone scope (M1–M3), and absent or contradicting the PRD. |
| **NOT ATTEMPTED** | Belongs to a later milestone that has not been started. |
| **UNVERIFIED** | Implementation exists but the evidence the criterion demands is genuinely absent. |

---

## 2. Rollup

| Verdict | Count | Share |
|---|---|---|
| **MET** | **34** | 26.4% |
| **PARTIAL** | **21** | 16.3% |
| **NOT MET** | **13** | 10.1% |
| **NOT ATTEMPTED** | **59** | 45.7% |
| **UNVERIFIED** | **2** | 1.6% |
| **Total** | **129** | 100% |

**Movement since `8a584fc`:** MET 7 → **34**, PARTIAL 18 → **21**, NOT MET 39 → **13**, NOT ATTEMPTED 63 → **59**.

**Gates at `d4ba385` (all run live this review):** `tsc -b` → 0 · `eslint . --max-warnings=0` → 0 · `vitest run` → **144 passed / 23 files** · `pytest -q` → **131 passed** · `ruff check server scripts tests` → 0.

**Honest headline:** the M3 backend is now substantially real — 3-of-3 PoA, tamper events, SSE, a wired negotiation engine, a live HKO poller. The M1–M3 web surface is close to complete. **95 of 129 criteria remain unfinished**, and 59 of those are later-milestone scope that has not been started at all. The 13 NOT MET items are the ones that are genuinely late, not merely future.

---

## 3. COMPLETED — MET (34)

### 17.1 Blockchain core (5)
| # | Requirement | Evidence |
|---|---|---|
| S1 | Node boots and accepts transactions | FastAPI app + `POST /chain/tx` (`server/main.py`) |
| S2 | Append-only hash chain, `prev_hash` linkage | `append_block` + `verify_chain`; asserted by `probe_api.py` |
| S3 | 3-of-3 multi-signer validation | `server/authorities.py:167` `verify_quorum()` — Ed25519, rejects 2-of-3 and foreign keys |
| S4 | Tamper → `TAMPER_DETECTED` within one append cycle | Machine-readable `ChainFault` envelope, `EVENT_TAMPER_DETECTED` (`main.py:520`), streamed live on `/events` |
| S6 | `GET /chain`, `GET /block/{h}`, `GET /events` stream | All three present; SSE with `: replay-complete` history/live boundary |

### 17.3 LLM agents & negotiation (6)
| # | Requirement | Evidence |
|---|---|---|
| S17 | Conflict detection fires within 1 s of predicted crossing | `server/agents.py`, 1 s prediction / 10 s horizon |
| S19 | Round-2 ACCEPT / COUNTER / REJECT handled | `probe_agents.py` |
| S20 | Fixed tie-break executes on deadlock or LLM failure | FR-N5 fallback, Drone A yields +30 m |
| S21 | LLM killed → mission completes via tie-break | FR-N8 deterministic fallback |
| S22 | Negotiation latency ≤ 5 s from on-chain timestamps | `latencyMs` from **block** timestamps, `main.py:1683` |
| S23 | Provider swap GLM-4-Flash → Qwen/DeepSeek needs no code change | `BUSTARON_LLM_BASE_URL` / `BUSTARON_LLM_MODEL` (`agents.py:748-750`) |

### 17.6 HKO weather (5)
| # | Requirement | Evidence |
|---|---|---|
| S35 | Server polls HKO, caches to `weather_cache.json` with timestamp | `server/weather.py`, 5-min TTL |
| S37 | Negotiation evidence includes `wind_kmh` matching cache | `main.py:1506` asserts cached value, not a fresh reading |
| S38 | Typhoon Signal 8+ → dispatch refused | `main.py:1407-1417` |
| S39 | HKO unreachable → HUD shows STALE, mission proceeds | `WeatherPanel.tsx:75,144` |
| S40 | `WEATHER` tx hash anchored at genesis matches cache | `main.py:953-955` |

### 17.14 Code quality & tests (3)
| # | Requirement | Evidence |
|---|---|---|
| S93 | Linting passes (ruff + eslint) | `ruff check server scripts tests` → 0; `eslint . --max-warnings=0` → 0 |
| S94 | README documents setup, run, test | `README.md` present with milestone table |
| S95 | `.env.example` with all required env vars | Mapbox, M3 API URL, Open3Dhk, Cesium Ion, `BUSTARON_DATA_DIR`, 3 authority seeds — all documented |

### 17.16 Web app dashboards (15)
| # | Requirement | Evidence |
|---|---|---|
| S104 | Operator landing is 2D map; 3D hidden behind "3D View" tab | `ThreeDViewPanel.tsx`; tab in `SidebarNav.tsx:80` |
| S105 | Own drones as arrows with altitude labels | `MapboxMap.tsx:151-188` |
| S106 | Restricted = red **with hatching**; sandbox = amber | Hatch landed: `MapboxMap.tsx:50,96,116,136` |
| S107 | Grid cells coloured by occupancy | `skycells.ts`, `MapboxMap.tsx:87-101` |
| S108 | Weather overlay: wind arrows + precipitation | `weatherArrow` source/layer live on the Mapbox path |
| S109 | Five altitude band filters | `AltitudeBandControls.tsx` |
| S110 | Stats bar: Active Drones, Credits, ESG, Pending Alerts | `AppShell.tsx:54-59` |
| S111 | Sidebar: Live Map, Flight Plans, Credit Wallet, ESG Scorecard, Fleet, Analytics, Alerts, 3D View | **All 8 present** (`SidebarNav.tsx:31-80`) |
| S115 | Alerts tab with severity, type, source, timestamp, acknowledge | `AlertsPanel.tsx:23,42-44` |
| S116 | Admin landing = 2D map, all drones, KPIs, emergency button | `TacticalMap.tsx:143`, `TopBar.tsx:98-107` |
| S121 | Approvals queue: risk badges, Approve/Reject + mandatory reason | `ApprovalsQueuePanel.tsx`, `creditsService.ts:264-267` |
| S126 | 3D View opens full-screen | `ThreeDViewPanel.tsx` (T15) |
| S127 | 3D shows terrain, extruded RFZ volumes, drones at altitude | vitest: "3D scene construction (S127)" |
| S128 | 3D layer toggles (buildings, terrain, RFZs, trails, weather, heatmap) | vitest: "3D layer toggles (S128)" |
| S129 | "Exit 3D View" returns to 2D | `ThreeDViewPanel.tsx:180` |

---

## 4. OUTSTANDING — by PRD section (95)

### 4.1 PARTIAL (21) — started, not finished

| # | Requirement | Status / what is missing | Pri |
|---|---|---|---|
| **S16** | A* avoids all 286 restricted RFZ polygons, sandbox = high cost not infinite | A* is correct, but runs on **284** zones (2 verified byte-identical CAD duplicates removed), no merged LandsD+CAD dataset, not agent-driven | P0 |
| **S25** | Negotiation messages submitted as txs, acted on after confirmation | **MET** for engine-produced exchanges (3 anchored blocks). Drone-originated submissions deferred — `NEGOTIATION` is server-minted | P0 |
| **S36** | Agent path cost incorporates wind speed | `wind_cost_factor()` exists and is probed (`server/weather.py:112`), but is **not wired into the agent's planner** — its own docstring calls this a follow-up | P0 |
| **S41** | Flight plan CRUD via dashboard **and** REST API | Dashboard draft + A* exists; no REST flight-plan endpoints | P0 |
| **S42** | A* avoids restricted RFZs and adds wind/traffic penalties | RFZ avoidance ✓; wind penalty is server-side only and unwired; traffic penalty partial | P0 |
| **S44** | Sealed-bid auction; winner gets slot, **loser gets alternatives** | Bid + award + escrow refund ✓; **not sealed-bid**; losers get refunds, not alternatives | P0 |
| **S47** | Credit wallet: balance, **daily grant**, ledger **with on-chain hashes** | Balance + ledger ✓; no daily grant; ledger entries carry no tx hash | P0 |
| **S88** | Admin corrupts old block → `TAMPER_DETECTED` renders in viewer | Event exists, is machine-readable and streams live; **no dedicated viewer render** | P0 |
| **S91** | pytest passes, ≥60 tests covering chain, agents, negotiation, tamper, API, **equipment, maintenance, training, flight logs** | **131 pytest pass** (≥60 ✓), covering chain / agents / negotiation / tamper / API. The last four areas are untestable — **those modules do not exist** (S51–S67) | P0-BLOCKED |
| **S97** | Open3Dhk fallback → OSM Buildings + World Terrain within 5 s | Provider ladder implemented (`cesiumLoader.ts`); no live 5-s fallback measurement | P1 |
| **S100** | RFZ metadata queryable: name, authority, effective date, zone type | Served by `GET /api/zones`, but `type` is `"RFZ"` for every feature; restricted/sandbox is name-derived client-side | P0 |
| **S101** | Sandbox (25) amber **with hatch**; restricted (261) red translucent | Hatch landed ✓ (S106); counts are **24/260**, not 25/261 | P0 |
| **S103** | 3D zone hover/click shows name, authority, period, type | 3D viewer now exists; hover/click metadata not verified | P1 |
| **S112** | Flight Plans tab: full CRUD, map preview, risk analysis, approval status | `FlightPlansPanel.tsx` exists; CRUD/risk-analysis depth unverified | P0 |
| **S113** | Credit Wallet: balance, transactions, **30-day chart**, **on-chain tx hashes** | 30-day chart ✓ (`creditSeries.ts`); ledger entries still lack tx hashes | P0 |
| **S114** | Fleet tab: status, battery, location, **maintenance due** | `FleetPanel.tsx` ✓; no maintenance-due field (blocked on S53) | P0-BLOCKED |
| **S117** | Admin KPIs: Active Drones, TPS, City Risk, Pending Approvals, **Active Alerts** | 4 of 5 — Active Alerts missing | P0 |
| **S118** | "Declare Emergency" visible and triggers system-wide protocol | Toggle exists, but labelled "Emergency hold" and triggers no system-wide protocol | P0 |
| **S119** | Live alert ticker, colour-coded by severity | `AlertsPanel` exists; ticker form unverified | P0 |
| **S120** | Admin sidebar: 10 entries | **3 of 10** — Approvals Queue, Airspace Mgmt, Admin Control. Missing: System Dashboard, Blockchain Audit, Counter-Drone, UAV Police, Operators, Analytics, Alerts, 3D View | P0 |
| **S125** | Admin Analytics: heatmaps, regulatory evidence, airspace utilisation | `AnalyticsPanel.tsx` exists; depth unverified | P0 |

### 4.2 NOT MET (13) — in scope, genuinely late

| # | Requirement | Why it fails | Pri |
|---|---|---|---|
| **S5** | 60-second Merkle roots computed and appended | `grep -rin merkle server/ src/` → **0 hits**. No telemetry source (M4/ESP32) | P0-BLOCKED |
| **S15** | Agent reads genesis block and parses its mission | No genesis mission parser exists (`grep genesis server/agents.py` → 0) | P0 |
| **S18** | Round-1 proposal is a signed JSON envelope | Envelope is structurally correct but **`sig_drone` is empty** — blocked on ESP32 key material | P0-BLOCKED |
| **S24** | Drones read mission data from the chain, not a central server | Frontend reads REST/mock state; no drone processes exist | P0-BLOCKED |
| **S43** | Risk analysis: per-cell risk score with factor breakdown | **No risk score anywhere** — `grep risk_score\|riskScore` across `server/` and `src/` → 0 hits, despite T14 claiming "risk scoring" | P0 |
| **S45** | ESG multiplier applied to effective bid | `grep esg src/services/creditsService.ts` → 0 hits | P0 |
| **S46** | Emergency services get zero-cost priority | Absent | P0 |
| **S48** | Smart toll: per-minute deduction by zone type and time of day | Absent | P0 |
| **S49** | Congestion heuristic: cells > 70% capacity raise next-round prices | Occupancy bands exist (`skycells.ts`) but are **not coupled to pricing** | P0 |
| **S50** | ERP auto-generated per flight plan, exportable to PDF | Absent | P0 |
| **S98** | `data/rfz_landsd.geojson` loads 286 polygons at startup | File does not exist; no root `data/` dir. Shipped dataset = **284**. Adjudicated: the PRD contradicts itself (S98's 286 vs S99's "deduplicate") | P0 |
| **S99** | `data/nofly_merged.geojson` dedupes LandsD + CAD | No merged artifact; no LandsD source dataset in repo | P0 |
| **S122** | Blockchain Audit view: searchable feed, block explorer, tamper alerts | Absent (`grep` → 0 hits) | P0 |
| **S123** | Counter-Drone: threat levels, active contacts | Absent | P0 |
| **S124** | Operators list: fleet size, credits, ESG, compliance | Absent | P0 |

### 4.3 NOT ATTEMPTED (59) — later milestone, not started

| PRD § | Criteria | # | Gated behind |
|---|---|---|---|
| **17.1** | S5 | 1 | M4 ESP32 telemetry (listed here as blockchain; counted once) |
| **17.2** ESP32 firmware | S7–S14 | 8 | **M4** — key generation, 10 Hz sim, L2 geofence/proximity/link-loss, ARM/FLY_TO/HOLD/RESUME/LAND |
| **17.3** | S15 | 1 | (counted in NOT MET above) |
| **17.4** | S26 | 1 | **M4** — no drones to hold on chain outage |
| **17.5** Demo display | S27–S34 | 8 | **M4** — ESP32 static page, CesiumJS, Open3Dhk, HUD |
| **17.8** Equipment/maintenance/training | S51–S61 | 11 | **M5** — registry, battery, maintenance, training, checklist, LMRA, incident, debriefing, safety meetings |
| **17.9** Flight logs & exports | S62–S67 | 6 | **M5** — post-flight log, `FLIGHT_LOG` tx, DJI import, PDF/Excel export |
| **17.10** Customer portal & API | S68–S75 | 8 | **M5** — portal, `/api/v1/login`, `X-Portal-API-Key`, branding, CRUD, 2FA, activity logs |
| **17.11** Post-flight analytics | S76–S80 | 5 | **M5** — analytics engine, heatmaps, chokepoint, anomaly, regulatory evidence |
| **17.12** BVLOS operations | S81–S86 | 6 | **M6** — projects, recurring patterns, shift planning, capacity, efficiency, observations |
| **17.13** E2E demo | S87, S89, S90 | 3 | **M4/M6** — full mission run, L2 kill test, three clean runs |
| **17.15** | S96 | 1 | **M4** — Open3Dhk key + tileset |

**Subtotal 59.** (S5, S15, S96 are listed in the tables above for traceability; the counts in §2 place S5 in NOT ATTEMPTED, S15 and S96 per their own verdicts.)

### 4.4 UNVERIFIED (2)

| # | Requirement | Why unverifiable |
|---|---|---|
| **S92** | No unhandled exceptions in any end-to-end run | No true end-to-end run exists yet (depends on S87/M4). `probe_lifecycle.ts` 38/38 is a proxy |
| **S102** | Point-in-polygon against merged dataset < 10 ms | Ray-casting PIP + bbox pre-filter exist (`pointInPolygon.ts`), but there is **no benchmark, no perf test, no < 10 ms assertion** anywhere |

---

## 5. Flags — problems found during this review

### 5.1 Three commits landed with no trace or vault entry
`e2f225b` (T13), `e80adaf` (T14), `d4ba385` (T15) have **no `TRACE.md` entry and no vault progress note**. This is the repo's recurring failure mode first identified in STEP 0 (run 2): a coherent increment that all four gates are blind to. Their claims could not be taken at face value and had to be re-verified from source — which is how S43 and S36 were caught.

### 5.2 T15 changed the theme to light; the PRD requires dark
PRD **FR-OP-V1** specifies a **dark theme** 2D map. T15 changed `--color-bg` to `#f5f6f8` (light) and swapped Mapbox `dark-v11 → streets-v12`, leaving only `:root` light tokens with no dark palette and no `prefers-color-scheme`. `README.md` still says *"A dark tactical 2D/3D airspace console"*. **The code, the PRD and the README now disagree.** Needs a decision: revert to dark, or amend the PRD.

### 5.3 Skycell grid drift between server and client
T14 set the frontend to `SKYCELL_SIZE_M = 500` with bounds 22.15–22.60 N / 113.82–114.52 E, while `server/agents.py` still uses `SKYCELL_SIZE_M = 600.0` with bounds 22.255 / 114.095. **"Cell" now means two different things** in the negotiation engine and on the map — a correctness bug, not a cosmetic one.

### 5.4 T14 claims "risk scoring"; no risk score exists
`grep risk_score|riskScore` across `server/` and `src/` returns nothing. S43 is NOT MET. Either the work landed under a different name or the commit message overstates it.

### 5.5 The PRD contradicts itself on zone counts
S98/S101 require **286** polygons (261 restricted + 25 sandbox); S99 requires the merged dataset to **deduplicate** overlapping polygons. The raw CAD pack has 286 features including 2 byte-identical duplicates, so a correct dedupe yields **284** (260 + 24). Both cannot hold. Recommendation: amend the PRD to 284/260/24 and name the two dropped duplicates so the number is auditable. **S98/S99 remain NOT MET as literally written** until then.

---

## 6. Recommended order of work

1. **Resolve the two correctness conflicts** — §5.2 theme (PRD vs code vs README) and §5.3 skycell drift. These are cheap and they corrupt downstream scoring.
2. **Close the 13 NOT MET items**, cheapest first: S43 (risk score), S45/S46 (ESG bid multiplier, emergency priority), S47 (daily grant + tx hashes), S49 (congestion→pricing), S100/S101 (zone type field + counts), S117 (Active Alerts KPI).
3. **Finish the admin surface** — S120 (7 missing sidebar entries), S122/S123/S124 (Blockchain Audit, Counter-Drone, Operators). These are the largest visible gap in the M1–M3 scope.
4. **Reconcile the PRD** on zone counts (§5.5) so S98/S99 become decidable.
5. **Log T13/T14/T15** into `TRACE.md` + vault, per the STEP 4 discipline.
6. **Then start M4** — 5 remaining NOT MET items (S5, S18, S24, S26, S96) and 59 NOT ATTEMPTED items are all blocked behind ESP32 firmware, CesiumJS/Open3Dhk, or the M5/M6 platforms.
