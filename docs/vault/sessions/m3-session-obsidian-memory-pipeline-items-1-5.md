---
type: Session
status: done
date: 2026-09-26
tags: [session, m3, obsidian, memory]
related: ["[[m3-scope-backend-ledger-agents]]", "[[vault-lives-at-docs-vault-and-is-configurable]]"]
---

# M3 session - Obsidian memory pipeline items 1-5

## Session goal
- Stop BUSTARON from being re-derived every session. Turn the scattered root-level handoff docs (`TRACE.md`, `HANDOFF.md`, `VERIFICATION_REPORT.md`) and `.workbuddy-ai/memory/` logs into a linked, indexable, searchable Obsidian vault that lives with the repo.
- This note covers plan item 5 (this agent's scope). Items 1-4 ran in the same session under other agents; their outcomes are recorded here from `TRACE.md`.

## What was done
- **Item 5 (this agent) — Obsidian memory pipeline.**
  - Scaffolded the vault at `docs/vault/` — see [[Vault lives at docs/vault and is configurable]].
  - Wrote five structured note templates with YAML frontmatter under `docs/vault/_templates/`.
  - Wrote `tools/obsidian.mjs`, a dependency-free Node CLI with `new` / `index` / `search` / `link`.
  - Generated `Index.md` (MOC) and seeded the vault with the decisions, bug and spec already established in the repo.
- **Items 1-4 (other agents), per `TRACE.md`:**
  - T1 drift analysis (PRD + design docs vs implementation). Six PRD-level defects found and deferred — see [[PRD defects 1-6 deferred out of scope this session]].
  - T2 CAD data repair: ring-order corruption fixed, dedupe made identity-based — see [[CAD ring-order corruption broke RFZ containment]].
  - T3 Mapbox: SDK loaded via CDN, token from env, SVG fallback — see [[Mapbox SDK loaded via CDN because npm install is banned]].
  - Item 4 UI: responsive breakpoints and the map `role="img"` a11y defect.

## Artifacts produced
- `docs/vault/README.md` — what the vault is, conventions, retrieval workflow.
- `docs/vault/Index.md` — generated map of content.
- `docs/vault/_templates/{Decision,Spec,Progress,Bug,Session}.md`.
- `tools/obsidian.mjs` — capture and retrieval CLI.
- Seeded notes: 4 Decisions, 1 Bug, 1 Spec, 1 Progress, 1 Session (this one).

## Verification
- `bun tools/obsidian.mjs index` run twice → byte-identical `Index.md` (sha1 `26fbe69852f1edf4c823a7e6ea1f9982701da629` on both runs).
- `bun tools/obsidian.mjs search "Douglas"` → 9 matching lines printed as `path:line`, exit 0.
- `bun tools/obsidian.mjs new Decision "Test decision"` → note created; `search "Test decision"` found it; test note then deleted and `index` re-run, leaving 9 notes.
- `bun tools/obsidian.mjs link` is idempotent — the second run reports "already linked".
- All four gates green: `tsc -b` 0 · `vite build` 0 · `eslint . --max-warnings=0` 0 · `vitest run` 0 with **66/66 tests passing** across 10 files (raised from 56 by other agents' work this session).

## Open threads for the next agent
- PRD defects 1-6 are still open — see [[PRD defects 1-6 deferred out of scope this session]]. They are the first real M3 product work.
- M3 itself (FastAPI + PoA ledger + agents) is not started; its scope is captured in [[M3 scope - backend, ledger, agents]].
- Write a `Session` note at the end of every future session — that is the contract that keeps this vault useful.

## Read next
- [[CAD ring-order corruption broke RFZ containment]]
- [[CAD rings simplified with Douglas-Peucker after farthest-point corruption]]
- [[M3 scope - backend, ledger, agents]]
- [[Vault lives at docs/vault and is configurable]]

## Related
- [[m3-scope-backend-ledger-agents]]
- [[vault-lives-at-docs-vault-and-is-configurable]]
