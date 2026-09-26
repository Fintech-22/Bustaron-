---
type: Readme
status: stable
tags: [readme, moc, obsidian]
related: []
---

# BUSTARON Vault

This is the project's **memory**. It exists so that no future AI session or engineer
has to re-read the whole repository to find out what was decided, what is specced, what
broke, and what happened last session.

It is a plain-markdown Obsidian vault that lives with the code, so it is versioned and
reviewed like everything else.

- **Vault path:** `docs/vault/`
- **Start here every session:** [`Index.md`](Index.md) — the map of content.

---

## 1. Why this exists

BUSTARON is built across many sessions and many agents. Before this vault, each session
re-derived context from `TRACE.md`, `HANDOFF.md`, `VERIFICATION_REPORT.md` and
`.workbuddy-ai/memory/`. That works once, but it does not scale and it loses the *why*.

The vault fixes that by giving every significant item a **typed, linked, searchable note**:

| Root-level doc | Role after this vault exists |
|---|---|
| `TRACE.md` | Chronological session trace. Append-only. Keep it. |
| `HANDOFF.md` | Cold-start handoff. Keep it. |
| `VERIFICATION_REPORT.md` | Point-in-time verification. Keep it. |
| `docs/vault/**` | **Durable, linked knowledge.** This is where the *why* lives. |

The root docs are history; the vault is the index into that history plus the decisions
and specs that outlive a single session.

---

## 2. Assumption recorded (read this)

The user did not specify a vault path. **Assumption:** the vault defaults to
`<repo>/docs/vault/` so it lives with the project and is committable.

The path is configurable through a **single constant** at the top of `tools/obsidian.mjs`:

```js
const DEFAULT_VAULT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'vault');
const VAULT_DIR = resolve(process.env.BUSTARON_VAULT || DEFAULT_VAULT);
```

To use a different vault without editing code, set `BUSTARON_VAULT`:

```bash
BUSTARON_VAULT="/path/to/other/vault" bun tools/obsidian.mjs index
```

---

## 3. Folder convention

```text
docs/vault/
  README.md        <- this file: conventions + retrieval workflow
  Index.md         <- GENERATED map of content. Do not edit by hand.
  _templates/      <- one template per note type (Obsidian {{date}} / {{title}} syntax)
  decisions/       <- Decision notes: the calls made and why
  specs/           <- Spec notes: requirements and their current state
  progress/        <- Progress notes: session work logs
  bugs/            <- Bug notes: symptom -> root cause -> fix -> regression test
  sessions/        <- Session notes: the handoff written at the end of a session
```

Rules:

- **`Index.md` is generated.** Never hand-edit it; `bun tools/obsidian.mjs index` overwrites it.
- **`_templates/` is not note content.** `index` and `search` both skip it.
- **Note filenames are slugs of the title** (e.g. `Test decision` → `test-decision.md`).
  The wikilink is the filename without `.md`: `[[test-decision]]`.
- **Never put secrets in a note.** The Mapbox token lives in gitignored `.env.local`, not here.

---

## 4. Note types and tag vocabulary

Each note carries YAML frontmatter: `type`, `status`, `date`, `tags`, `related`.

| Type | Folder | Default `status` | Purpose |
|---|---|---|---|
| `Decision` | `decisions/` | `draft` | A call that was made, the options rejected, and the consequences. |
| `Spec` | `specs/` | `draft` | A requirement, its source, acceptance criteria, and current state. |
| `Progress` | `progress/` | `in-progress` | What was attempted, succeeded, failed this session. |
| `Bug` | `bugs/` | `open` | Symptom, root cause, evidence, fix, regression test. |
| `Session` | `sessions/` | `done` | End-of-session handoff for the next agent. |

**`status` values:** `draft` · `open` · `in-progress` · `accepted` · `fixed` · `done` · `stable`.

**Tag vocabulary** — reuse these, add new ones sparingly:

| Tag | Means |
|---|---|
| `decision` `spec` `progress` `bug` `session` | the note type (always present) |
| `m1` `m2` `m3` | the milestone the note belongs to |
| `cad` `geospatial` `rfz` | CAD geodata, geometry, restricted flying zones |
| `mapbox` `map` | map rendering |
| `ui` `a11y` | frontend and accessibility |
| `backend` `ledger` `agents` | M3 backend, PoA ledger, LLM agents |
| `prd` `scope` | PRD-level requirements and scope calls |
| `environment` `build` | environment rules and build/tooling |
| `obsidian` `memory` `tooling` | this vault and its tooling |

`related` holds wikilinks to connected notes, e.g. `related: ["[[CAD rings simplified with Douglas-Peucker after farthest-point corruption]]"]`.

---

## 5. Retrieval workflow — how an agent starts a session

Do this **before** reading source code. It takes under a minute.

1. **Read `docs/vault/Index.md`.** It is grouped by note type and its first section,
   *"Start here for a new session"*, points at the newest Session note.
2. **Read the newest `Session` note** (`sessions/`). It is the handoff: what the last
   agent did, what it verified, and what is still open.
3. **Read the `Decision` and `Spec` notes relevant to your task.** Follow the
   `related:` frontmatter and the inline `[[wikilinks]]` — the graph is the point.
4. **Search for a specific fact** instead of scrolling:
   ```bash
   bun tools/obsidian.mjs search "Douglas"
   bun tools/obsidian.mjs search "sandbox"
   bun tools/obsidian.mjs search "320-400"
   ```
   Search prints `path:line: matching line` for every hit.
5. Only then open `src/`, `docs/system_design.md` and the root handoff docs.

### How an agent ends a session

1. Capture anything that will be needed later:
   ```bash
   bun tools/obsidian.mjs new Decision "Use Postgres for the ledger store"
   bun tools/obsidian.mjs new Bug "Auction escrow double-releases on retry"
   bun tools/obsidian.mjs new Spec "M3 acceptance criteria"
   ```
2. Fill in the generated note's sections (context, evidence, consequences — **evidence, not claims**).
3. Write the handoff:
   ```bash
   bun tools/obsidian.mjs new Session "M3 session - <what you did>"
   ```
   and fill in *Session goal / What was done / Artifacts / Verification / Open threads / Read next*.
4. Wire the graph so the next agent can traverse it:
   ```bash
   bun tools/obsidian.mjs link "<note A>" "<note B>"
   ```
5. Regenerate the index and commit `docs/vault/**`:
   ```bash
   bun tools/obsidian.mjs index
   ```

---

## 6. Capture tooling — `tools/obsidian.mjs`

A dependency-free Node CLI (Node stdlib only, **no npm packages**). Run it with bun:

```bash
B="C:/Users/user/AppData/Local/Programs/@codebufffreebuff-desktop/resources/bun/bun.exe"

"$B" tools/obsidian.mjs help
"$B" tools/obsidian.mjs new <Decision|Spec|Progress|Bug|Session> "<title>"
"$B" tools/obsidian.mjs index
"$B" tools/obsidian.mjs search "<query>"
"$B" tools/obsidian.mjs link "<noteA>" "<noteB>"
```

| Command | What it does |
|---|---|
| `new <type> "<title>"` | Creates a note from the matching template in the right folder, fills frontmatter (`type`, `status`, `date`, `tags`, `related`), and regenerates `Index.md`. Filename is a slug; collisions get `-2`, `-3`. |
| `index` | Scans all notes, reads frontmatter, groups by type, and rewrites `Index.md` with wikilinks. **Idempotent** — repeated runs are byte-identical. |
| `search "<query>"` | Case-insensitive full-text search across notes (templates excluded), printing `path:line: matching line`. Exits non-zero when there are no matches. |
| `link "<a>" "<b>"` | Adds `[[b]]` to `a`'s `related` frontmatter **and** a bullet under `a`'s `## Related` section (and vice versa), then regenerates the index. Idempotent. |

Notes are resolved by path (`decisions/foo`), by bare name (`foo`), or with `.md`.

> This tool is listed in `eslint.config.js`'s ignore list (`tools/**`), so the
> browser-globals lint config does not apply to it. Do not weaken lint rules to
> accommodate tooling.

---

## 7. Reading this vault in Obsidian

Open the folder `docs/vault/` as a vault. Everything is standard markdown:
`[[wikilinks]]`, YAML frontmatter, and `_templates/` compatible with the core
**Templates** plugin (`{{date}}`, `{{title}}`). The graph view shows the link
structure built up by `related:` and inline wikilinks.

No Obsidian plugins are required — the vault is plain text and the CLI is the
source of truth for the index.
