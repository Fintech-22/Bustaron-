# BUSTARON v3

Hong Kong drone airspace / UTM (Unmanned Traffic Management) operations platform.

A dark tactical 2D/3D airspace console for drone fleet operations: live tactical map,
route planning against real CAD restricted-flying-zone data, a credits/auction slot
market, an approvals workflow, and a hash-chained audit ledger.

The authoritative specification is `BUSTARON_PRD.md` (kept outside this repository —
see *Specification* below).

---

## Status

| Milestone | Scope | State |
|---|---|---|
| **M1** | Frontend tactical shell, mock data, 2D map | ✅ done |
| **M2** | Data adapters (CAD RFZ pack), A* route planning, credits/auctions | ✅ done |
| **M3** | FastAPI ledger + server state, behind the `DataBackend` seam | 🟡 phase 1 done |
| **M4** | ESP32-S3 firmware, CesiumJS 3D view | ⬜ not started |
| **M5** | Equipment / maintenance / training / incidents / customer portal | ⬜ not started |
| **M6** | BVLOS operations, end-to-end hardening | ⬜ not started |

M3 phase 1 ships a hash-chained append-only ledger, server-persisted state, a
transaction endpoint (`AUCTION_BID`, `AUCTION_AWARD`, `APPROVAL_DECIDE`,
`AUCTION_SETTLE`, `APPROVAL_FILE`) and **3-of-3 Proof-of-Authority consensus**
(§9, S3): every block is co-signed by all three authorities and is only anchored —
and only accepted on read — when that quorum verifies. Still outstanding for M3:
the LLM agent negotiation protocol (PRD §8), a WebSocket `/events` stream (S6), the
HKO weather poller (§5.2), and moving fleet/mission data server-side.

---

## Prerequisites

- **Node.js 22+** (a managed runtime is available under `.workbuddy-ai/binaries/node`)
- **Python 3.13** (for the M3 backend)
- **bun** — used to run the TypeScript toolchain (see *Conventions*)

The frontend is a Vite + React 18 + TypeScript SPA. `mapbox-gl` is **CDN-loaded**, not
an npm dependency, so there is nothing to install for the map.

---

## Setup

```bash
# 1. Environment
cp .env.example .env.local
# then edit .env.local — see Environment variables below

# 2. Python backend dependencies (already installed in this workspace)
#    fastapi + uvicorn (HTTP) and cryptography (Ed25519 PoA signatures, PRD §9)
python -m pip install -r requirements.txt
```

`.env.local` is gitignored. **Never commit it.**

---

## Environment variables

| Variable | Side | Default | Purpose |
|---|---|---|---|
| `VITE_MAPBOX_TOKEN` | client | *(unset)* | Mapbox **public** (`pk.*`) token. Unset/blank ⇒ the offline SVG map is used. Anything with a `VITE_` prefix is inlined into the shipped bundle, so never put a secret token here. |
| `VITE_M3_API_URL` | client | `http://127.0.0.1:8000` | Base URL of the M3 FastAPI backend. |
| `BUSTARON_DATA_DIR` | server | `<repo>/server/data` | Directory holding `state.json`. Server-side only. |
| `BUSTARON_ENV` | server | *(unset)* | Set to `production` to require explicit authority seeds. Server-side only. |
| `BUSTARON_AUTHORITY_NODE_ADMIN_SEED` | server | *(derived)* | 64-hex (32-byte) Ed25519 seed for the `node:admin` authority. Unset ⇒ a deterministic dev seed is derived. Server-side only. |
| `BUSTARON_AUTHORITY_NODE_AGENT_A_SEED` | server | *(derived)* | As above, for the `node:agent_a` authority. |
| `BUSTARON_AUTHORITY_NODE_AGENT_B_SEED` | server | *(derived)* | As above, for the `node:agent_b` authority. |

---

## Running

### Frontend

```bash
bun node_modules/vite/bin/vite.js --host 127.0.0.1          # dev server
bun node_modules/vite/bin/vite.js build                     # production build → dist/
bun node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort
```

### Backend (M3)

```bash
python -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

The server seeds `server/data/state.json` on first boot and persists every mutation
atomically. **`state.json` deliberately survives restarts** — delete it to force a
re-seed. The frontend picks the backend through the source picker in the Credit Wallet
panel (`Mock replay` / `CAD RFZ GeoJSON` / `M3 FastAPI server`).

> In sandboxed/agent environments the shell may reap child processes when a command
> returns, so a server started in one call can be dead by the next. Launch and probe
> the backend inside a single shell invocation.

---

## Testing

### Gates

All four must pass. `npm` is **not** used here — see *Conventions*.

```bash
B="C:/Users/user/AppData/Local/Programs/@codebufffreebuff-desktop/resources/bun/bun.exe"
"$B" node_modules/typescript/bin/tsc -b                            # 1. types
"$B" node_modules/vite/bin/vite.js build                           # 2. build
"$B" node_modules/eslint/bin/eslint.js . --max-warnings=0          # 3. lint
"$B" node_modules/vitest/vitest.mjs run                            # 4. tests — 94 tests / 14 files
```

### Behavioural probes

Beyond unit tests, these drive real behaviour end-to-end:

| Probe | Covers | Expected |
|---|---|---|
| `bun scripts/probe_lifecycle.ts` | init, route planning, escrow, award, settle, approvals, altitude bands, skycells, operator scoping, seam registry | 38/38 |
| `bun scripts/probe_routes.ts` | every ordered pair of named waypoints routes against the real 284-zone pack | 42/42 |
| `bun scripts/probe_m3_seam.ts` | store → server transaction → chain anchor → re-hydrate | 7/7 (needs the API up) |
| `python server/probe_api.py` | full API lifecycle, escrow math, 422/409 contracts, chain linkage, 3-of-3 `sigs` quorum, four tamper vectors (txs / signature / 2-of-3 / unknown signer), restart persistence | 52/52 |

`probe_api.py` is self-contained and idempotent: it kills any listener on `:8000`,
re-seeds from scratch, starts the server itself, and asserts absolute seed balances —
so it returns the same result however many times it runs.

---

## Project structure

```
index.html                  Vite entry; loads the Mapbox SDK from CDN
src/
  components/
    layout/                 AppShell, SidebarNav, TopBar
    map/                    MapHost → MapboxMap | TacticalMap (offline SVG)
                            MapLayerControls, AltitudeBandControls, DroneMarker
    panels/                 MissionPanel, CreditWalletPanel, ApprovalsQueuePanel,
                            StatusPanel, AdminPanel
    common/                 MetricCard, EmptyState
  services/
    dataBackend.ts          the seam: mock | cad-geojson | m3-server
    dataBackends.ts         backend registry + selection
    m3Backend.ts            M3 FastAPI adapter (hydrate + submitTx)
    routePlanner.ts         A* over a 600 m lattice (RFZ/sensitive block, sandbox ×2.5)
    creditsService.ts       escrow, auctions, approvals, ledger
    skycells.ts             occupancy-banded airspace grid
    zoneGeoJson.ts          domain → GeoJSON for the map layers
    zoneClassification.ts   sandbox-vs-restricted taxonomy
    cadGeoJsonService.ts    loads the CAD RFZ pack
    altitudeBands.ts        the five PRD altitude bands
    geo/pointInPolygon.ts   ray-casting PIP with a bbox pre-filter
  store/dashboardStore.ts   Zustand — single source of truth for all panels + maps
  data/cadRfzData.json      284 CAD RFZ zones (see Data below)
  styles/globals.css        design tokens + all styling
server/
  main.py                   FastAPI app: ledger, state, /chain/tx, read endpoints
  authorities.py            the 3 PoA authorities + Ed25519 sign/verify/quorum (PRD §9)
  probe_api.py              behavioural API probe
scripts/
  generate_cad_data.py      CAD GeoJSON → compact zone pack
  probe_*.ts                behavioural probes
tools/                      verification utilities (screenshots, layout, mapbox)
docs/                       system design, milestones, Obsidian vault
requirements.txt            M3 backend Python dependencies (fastapi, uvicorn, cryptography)
```

---

## Data

`src/data/cadRfzData.json` holds **284 distinct zones** (24 sandbox / 260 restricted),
generated from the CAD HK RFZ pack by `scripts/generate_cad_data.py`.

The generator drops a feature only when it has an **identical name *and* identical
ring geometry** — a genuine duplicate. The raw source pack contains 286 features
(25 sandbox); the 2-feature difference is exactly that de-duplication, so 284 is the
correct count of distinct zones. Note that PRD S98/S101 quote the raw count (286 / 25).

---

## Conventions

- **Do not use `npm`.** `npm install` triggers a host file-operation guard that renames
  files to `*.DELETE.<hash>` instead of deleting them, silently breaking packages. Use
  bun against the local binaries (commands above). The `package.json` scripts invoke
  local binaries directly for the same reason.
- **Accessibility is first-class** (WCAG AA intent): real `<button>`s,
  `aria-pressed` / `aria-current`, visible focus rings, semantic headings, and
  mobile-first breakpoints at **768 / 1024 / 1440 px**.
- **The 2D tactical map is the landing view.** 3D is a separate tab (M4).
- **The store never talks to a data source directly** — everything goes through the
  `DataBackend` seam so mock, CAD and server sources stay swappable.
- Testing Library queries must be scoped (e.g. `within(getByRole('group', { name }))`):
  sidebar nav descriptions contain words like "routes" that collide with map layer labels.
- Run the probes after any behavioural change — green gates alone do not prove the UI
  or the ledger are correct.

---

## Specification

The PRD lives outside this repository (it is not committed here):

```
../2026-09-20-21-42-04/BUSTARON_PRD.md
```

It defines success criteria **S1–S129** in §17. Those are the stopping conditions for
the project; most of them belong to milestones M4–M6 and are not yet implemented.
