#!/usr/bin/env bun
/**
 * tools/obsidian.mjs — BUSTARON Obsidian memory pipeline.
 *
 * A dependency-free (Node stdlib only) CLI that turns the repo's decisions,
 * specs, progress and bugs into a linked, indexable Obsidian vault.
 *
 *   bun tools/obsidian.mjs new <Decision|Spec|Progress|Bug|Session> "<title>"
 *   bun tools/obsidian.mjs index
 *   bun tools/obsidian.mjs search "<query>"
 *   bun tools/obsidian.mjs link <noteA> <noteB>
 *   bun tools/obsidian.mjs help
 *
 * No npm packages are used. Never run `npm install` in this repo.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ────────────────────────────────────────────────────────────────────────────
 * CONFIG — the vault location lives here and nowhere else.
 * Default: <repo>/docs/vault (committable, lives with the project).
 * Override for a personal vault:  BUSTARON_VAULT="/path/to/vault" bun tools/obsidian.mjs index
 * ──────────────────────────────────────────────────────────────────────────── */
const DEFAULT_VAULT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'vault');
const VAULT_DIR = resolve(process.env.BUSTARON_VAULT || DEFAULT_VAULT);
/** Portable, machine-independent label for anything written into a committed file. */
const VAULT_LABEL = process.env.BUSTARON_VAULT ? VAULT_DIR : 'docs/vault';

const TYPES = {
  Decision: { dir: 'decisions', template: 'Decision.md', tag: 'decision' },
  Spec: { dir: 'specs', template: 'Spec.md', tag: 'spec' },
  Progress: { dir: 'progress', template: 'Progress.md', tag: 'progress' },
  Bug: { dir: 'bugs', template: 'Bug.md', tag: 'bug' },
  Session: { dir: 'sessions', template: 'Session.md', tag: 'session' },
};

const TYPE_ORDER = ['Session', 'Spec', 'Decision', 'Bug', 'Progress'];
const TEMPLATE_DIR = '_templates';

/* ── small path helpers ─────────────────────────────────────────────────── */

function toRel(p) {
  return relative(VAULT_DIR, p).split(sep).join('/');
}

function byRel(a, b) {
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;
}

function byDateDescThenRel(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return byRel(a, b);
}

/* ── frontmatter (a deliberately tiny YAML subset: scalars + inline arrays) ─ */

function parseScalar(raw) {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((s) => stripQuotes(s.trim()))
      .filter((s) => s !== '');
  }
  return stripQuotes(v);
}

function stripQuotes(s) {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function formatScalar(x) {
  const s = String(x);
  return /[",:\[\]{}#]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function formatValue(v) {
  if (Array.isArray(v)) {
    return v.length === 0 ? '[]' : `[${v.map(formatScalar).join(', ')}]`;
  }
  return formatScalar(v);
}

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { entries: [], body: text, hasFrontmatter: false };
  const entries = [];
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    entries.push([line.slice(0, idx).trim(), parseScalar(line.slice(idx + 1))]);
  }
  return { entries, body: text.slice(m[0].length), hasFrontmatter: true };
}

function serializeFrontmatter(entries) {
  return ['---', ...entries.map(([k, v]) => `${k}: ${formatValue(v)}`), '---', ''].join('\n');
}

/* ── vault scanning ─────────────────────────────────────────────────────── */

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function firstHeading(body) {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1].trim() : '';
}

function loadNotes() {
  const files = walk(VAULT_DIR).filter((f) => {
    const rel = toRel(f);
    if (rel.startsWith(`${TEMPLATE_DIR}/`)) return false;
    if (rel === 'Index.md') return false;
    return true;
  });
  return files.map((f) => {
    const text = readFileSync(f, 'utf8');
    const { entries, body } = parseFrontmatter(text);
    const fm = Object.fromEntries(entries);
    const name = f.split(/[\\/]/).pop().replace(/\.md$/, '');
    return {
      path: f,
      rel: toRel(f),
      name,
      text,
      body,
      entries,
      fm,
      type: typeof fm.type === 'string' && fm.type ? fm.type : 'Unknown',
      status: typeof fm.status === 'string' ? fm.status : '',
      date: typeof fm.date === 'string' ? fm.date : '',
      title: firstHeading(body) || name,
    };
  });
}

/* ── Index.md generation (deterministic → idempotent) ───────────────────── */

function buildIndexContent(notes) {
  const byType = new Map();
  for (const n of notes) {
    if (!byType.has(n.type)) byType.set(n.type, []);
    byType.get(n.type).push(n);
  }
  for (const list of byType.values()) list.sort(byDateDescThenRel);

  const newestSession = (byType.get('Session') || [])[0];

  const out = [];
  out.push('---');
  out.push('type: Index');
  out.push('status: generated');
  out.push('tags: [index, moc]');
  out.push('related: []');
  out.push('---');
  out.push('');
  out.push('# BUSTARON Vault — Index (MOC)');
  out.push('');
  out.push('> Auto-generated by `bun tools/obsidian.mjs index`. **Do not edit by hand** — the next `index` run overwrites it.');
  out.push('');
  out.push('## Start here for a new session');
  out.push('');
  out.push('1. Read the newest **Session** note — it is the handoff left by the previous agent.');
  if (newestSession) {
    const when = newestSession.date ? ` (${newestSession.date})` : '';
    out.push(`   - Newest: [[${newestSession.name}]]${when}`);
  } else {
    out.push('   - (none yet — create one: `bun tools/obsidian.mjs new Session "<title>"`)');
  }
  out.push('2. Skim this Index, then open the **Decision** and **Spec** notes relevant to your task.');
  out.push('3. Find a specific fact with full-text search: `bun tools/obsidian.mjs search "<term>"`.');
  out.push('4. Before you finish, capture your work: `bun tools/obsidian.mjs new Session "<title>"`.');
  out.push('');
  out.push('## Notes by type');
  out.push('');

  const orderedTypes = [
    ...TYPE_ORDER,
    ...[...byType.keys()].filter((t) => !TYPE_ORDER.includes(t)).sort(),
  ];
  for (const type of orderedTypes) {
    const list = byType.get(type);
    if (!list || list.length === 0) continue;
    out.push(`### ${type} (${list.length})`);
    out.push('');
    for (const n of list) {
      const meta = [n.status ? `status: ${n.status}` : '', n.date].filter(Boolean).join(' · ');
      out.push(`- [[${n.name}]] — ${n.title}${meta ? ` · ${meta}` : ''}`);
    }
    out.push('');
  }

  out.push('## Folder convention');
  out.push('');
  for (const [type, cfg] of Object.entries(TYPES)) {
    out.push(`- \`${cfg.dir}/\` — ${type} notes`);
  }
  out.push('');
  out.push(`_${notes.length} note(s) · vault: \`${VAULT_LABEL}\`_`);
  out.push('');
  return out.join('\n');
}

function writeIndex() {
  mkdirSync(VAULT_DIR, { recursive: true });
  const notes = loadNotes();
  writeFileSync(join(VAULT_DIR, 'Index.md'), buildIndexContent(notes), 'utf8');
  return notes.length;
}

/* ── commands ───────────────────────────────────────────────────────────── */

function normalizeType(input) {
  const key = Object.keys(TYPES).find((k) => k.toLowerCase() === String(input).toLowerCase());
  return key || null;
}

function slugify(title) {
  const s = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

function fallbackTemplate(type, tag) {
  return [
    '---',
    `type: ${type}`,
    'status: draft',
    'date: {{date}}',
    `tags: [${tag}]`,
    'related: []',
    '---',
    '',
    '# {{title}}',
    '',
    '## Notes',
    '',
    '## Related',
    '',
  ].join('\n');
}

function cmdNew(typeInput, title) {
  if (!typeInput || !title) {
    console.error('usage: new <Decision|Spec|Progress|Bug|Session> "<title>"');
    return 1;
  }
  const type = normalizeType(typeInput);
  if (!type) {
    console.error(`unknown note type "${typeInput}". Valid: ${Object.keys(TYPES).join(', ')}`);
    return 1;
  }
  const cfg = TYPES[type];
  const dir = join(VAULT_DIR, cfg.dir);
  mkdirSync(dir, { recursive: true });

  const slug = slugify(title);
  let file = join(dir, `${slug}.md`);
  let n = 2;
  while (existsSync(file)) file = join(dir, `${slug}-${n++}.md`);

  const templatePath = join(VAULT_DIR, TEMPLATE_DIR, cfg.template);
  let content = existsSync(templatePath)
    ? readFileSync(templatePath, 'utf8')
    : fallbackTemplate(type, cfg.tag);
  content = content.replace(/\{\{date\}\}/g, today()).replace(/\{\{title\}\}/g, title);

  writeFileSync(file, content, 'utf8');
  const count = writeIndex();
  console.log(`created  ${toRel(file)}`);
  console.log(`index    Index.md regenerated (${count} note(s))`);
  return 0;
}

function cmdIndex() {
  const count = writeIndex();
  console.log(`index    Index.md regenerated (${count} note(s))`);
  return 0;
}

function cmdSearch(query) {
  if (!query) {
    console.error('usage: search "<query>"');
    return 1;
  }
  const needle = query.toLowerCase();
  const notes = loadNotes().sort(byRel);
  let hits = 0;
  for (const n of notes) {
    const lines = n.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits++;
        console.log(`${n.rel}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  console.log(`-- ${hits} match(es) for "${query}" in ${VAULT_LABEL}`);
  return hits === 0 ? 1 : 0;
}

function findNote(notes, ref) {
  const clean = String(ref).replace(/\.md$/i, '').replace(/\\/g, '/');
  const lower = clean.toLowerCase();
  return (
    notes.find((n) => n.rel.toLowerCase() === `${lower}.md`) ||
    notes.find((n) => n.rel.toLowerCase() === lower) ||
    notes.find((n) => n.name.toLowerCase() === lower) ||
    notes.find((n) => n.name.toLowerCase() === lower.split('/').pop()) ||
    null
  );
}

function upsertRelatedEntry(entries, targetName) {
  const link = `[[${targetName}]]`;
  const idx = entries.findIndex(([k]) => k === 'related');
  if (idx === -1) {
    entries.push(['related', [link]]);
    return;
  }
  const current = entries[idx][1];
  const list = Array.isArray(current) ? current.slice() : current ? [current] : [];
  if (!list.includes(link)) list.push(link);
  entries[idx][1] = list;
}

function upsertBodyLink(body, targetName) {
  const bullet = `- [[${targetName}]]`;
  const lines = body.replace(/\s+$/, '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+related\s*$/i.test(l.trim()));
  if (start === -1) {
    lines.push('', '## Related', '', bullet);
    return lines.join('\n') + '\n';
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  if (lines.slice(start + 1, end).some((l) => l.trim() === bullet)) return body;
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, bullet);
  return lines.join('\n') + '\n';
}

function linkPair(note, targetName) {
  const before = note.text;
  const { entries, body, hasFrontmatter } = parseFrontmatter(note.text);
  const nextEntries = entries.length ? entries.map(([k, v]) => [k, Array.isArray(v) ? v.slice() : v]) : [];
  upsertRelatedEntry(nextEntries, targetName);
  const nextBody = upsertBodyLink(body, targetName);
  const next = `${hasFrontmatter ? serializeFrontmatter(nextEntries) : ''}${nextBody}`;
  if (next !== before) {
    writeFileSync(note.path, next, 'utf8');
    return true;
  }
  return false;
}

function cmdLink(refA, refB) {
  if (!refA || !refB) {
    console.error('usage: link <noteA> <noteB>');
    return 1;
  }
  const notes = loadNotes();
  const a = findNote(notes, refA);
  const b = findNote(notes, refB);
  if (!a) {
    console.error(`note not found: ${refA}`);
    return 1;
  }
  if (!b) {
    console.error(`note not found: ${refB}`);
    return 1;
  }
  if (a.path === b.path) {
    console.error('cannot link a note to itself');
    return 1;
  }
  const changedA = linkPair(a, b.name);
  const changedB = linkPair(b, a.name);
  writeIndex();
  console.log(`linked   [[${a.name}]] <-> [[${b.name}]]  (${changedA || changedB ? 'updated' : 'already linked'})`);
  return 0;
}

function cmdHelp() {
  console.log(`BUSTARON Obsidian memory pipeline

  vault    ${VAULT_DIR}

Usage:
  bun tools/obsidian.mjs new <Decision|Spec|Progress|Bug|Session> "<title>"
  bun tools/obsidian.mjs index
  bun tools/obsidian.mjs search "<query>"
  bun tools/obsidian.mjs link <noteA> <noteB>
  bun tools/obsidian.mjs help

Note types: ${Object.keys(TYPES).join(', ')}
Override the vault path with the BUSTARON_VAULT environment variable.`);
  return 0;
}

/* ── date ───────────────────────────────────────────────────────────────── */

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ── entry point ────────────────────────────────────────────────────────── */

function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'new':
      return cmdNew(rest[0], rest.slice(1).join(' ').trim());
    case 'index':
      return cmdIndex();
    case 'search':
      return cmdSearch(rest.join(' ').trim());
    case 'link':
      return cmdLink(rest[0], rest[1]);
    case 'help':
    case undefined:
    case '--help':
    case '-h':
      return cmdHelp();
    default:
      console.error(`unknown command "${command}"\n`);
      return cmdHelp() || 1;
  }
}

process.exit(main(process.argv.slice(2)));
