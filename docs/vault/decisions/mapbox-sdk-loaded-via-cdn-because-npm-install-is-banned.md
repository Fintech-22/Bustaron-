---
type: Decision
status: accepted
date: 2026-09-26
tags: [decision, mapbox, build, environment]
related: ["[[m3-scope-backend-ledger-agents]]"]
---

# Mapbox SDK loaded via CDN because npm install is banned

## Context
- The app must render a real 2D map with a Mapbox token, but this environment forbids `npm install` and `npm run *`, so adding `mapbox-gl` as a package dependency is impossible.
- `HANDOFF.md` §2/§4.2 and `.workbuddy-ai/memory/MEMORY.md` record the rule and the reason: reinstalling triggers the host safe-delete guard, which renames files to `*.DELETE.<hash>` and silently corrupts `node_modules`.
- Assumption A5 in `TRACE.md` and [[M3 scope - backend, ledger, agents]] require the app to keep working with no token (offline mode).

## Options considered
1. **Add `mapbox-gl` via npm** — blocked outright; `npm install` is banned in this environment.
2. **Vendor the SDK bundle into the repo** — works offline but commits a large third-party artifact and needs manual updates.
3. **Load the SDK from the Mapbox CDN at runtime (`api.mapbox.com/mapbox-gl-js/v3`)** — no dependency, no committed bundle; needs network at runtime.

## Decision
- Load the Mapbox GL JS SDK from the CDN at runtime, read the token from `import.meta.env.VITE_MAPBOX_TOKEN`, and keep the hand-rolled SVG tactical map as the fallback when no token is present.

## Consequences
- **Positive** — respects the no-install rule; no new dependency and no vendored bundle; offline behaviour unchanged.
- **Negative / trade-offs** — the real map needs network access; the SDK version is pinned by URL rather than a lockfile; a CDN outage degrades to the SVG map.
- **Follow-ups** — if the environment ever permits installs, move to a real `mapbox-gl` dependency and delete the CDN loader. The token stays in gitignored `.env.local` and must never enter source or this vault.

## Who / when
- Decided by: team-lead (assumption A6 in `TRACE.md`)
- Date: 2026-09-26
- Commit: `bb62680` — "M3: Mapbox map provider (token from env, SVG fallback)"

## Related
- [[m3-scope-backend-ledger-agents]]
