---
type: Decision
status: accepted
date: 2026-09-26
tags: [decision, obsidian, memory, tooling]
related: ["[[m3-session-obsidian-memory-pipeline-items-1-5]]"]
---

# Vault lives at docs/vault and is configurable

## Context
- The Obsidian memory pipeline (plan item 5) needs a vault location, and the user did not specify one.
- The vault must be available to every future agent session and should be versioned with the code so it cannot drift.

## Options considered
1. **An external personal vault** — invisible to other agents, not committed, breaks on another machine.
2. **A repo-root folder** — pollutes the root, which already carries `TRACE.md`, `HANDOFF.md`, `VERIFICATION_REPORT.md`.
3. **`<repo>/docs/vault/`** — lives with the project, is committable, and sits beside the other design docs.

## Decision
- Default the vault to `<repo>/docs/vault/`, exposed as a single constant at the top of `tools/obsidian.mjs` and overridable with the `BUSTARON_VAULT` environment variable.

## Consequences
- **Positive** — the vault travels with the repo and is versioned; one constant controls the location; no user input was needed to unblock the work.
- **Negative / trade-offs** — vault content is committed into the product repo, so note bodies must stay free of secrets. The Mapbox token stays in gitignored `.env.local`, never in the vault.
- **Follow-ups** — to use a personal vault instead, set `BUSTARON_VAULT` and re-run `bun tools/obsidian.mjs index`.

## Who / when
- Decided by: team-lead (assumption A4 in `TRACE.md`) and this agent
- Date: 2026-09-26

## Related
- [[m3-session-obsidian-memory-pipeline-items-1-5]]
