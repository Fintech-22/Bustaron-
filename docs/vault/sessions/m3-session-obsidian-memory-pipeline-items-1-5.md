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
<!-- filled in at the end of the session -->
- `bun tools/obsidian.mjs index` run twice → byte-identical `Index.md` (idempotent).
- `bun tools/obsidian.mjs search "<term>"` → real matching lines with paths.
- `bun tools/obsidian.mjs new` → `search` round-trip proven, test note deleted, index regenerated.
- All four gates green (see [[M3 documentation session progress]] for exit codes and test count).

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
