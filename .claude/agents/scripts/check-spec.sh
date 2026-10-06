#!/usr/bin/env bash
# Checks a spec written from specs/TEMPLATE.md against that template. Read-only.
#
#   check-spec.sh [--for-approval] [--root <dir>] <spec.md>…
#   check-spec.sh [--root <dir>] --next-id            # prints the next free Spec ID
#
# FAIL, per spec: folder and file name; header (title, Spec ID and its uniqueness, Status,
# Supersedes); the twelve sections, in order, none empty; item formats and duplicate IDs;
# EARS form of every AC (pattern tag, capital keywords, one `shall`, a named system, covers,
# verify ring and hint); vague words in AC / NFR; references that do not resolve; coverage
# (US → AC, the origin table, traceability, assumed → OQ, UI → AC | NFR); placement against
# `Packages:`; Open questions format; a [blocking] question on a spec that is not a draft;
# a `[NEEDS CLARIFICATION: … → OQ-n]` marker that is malformed or names no question, and,
# on a draft, a question no place in the text points at or an `assumed` item without its
# marker.
# --for-approval also fails on any [blocking] question and on a Status other than draft.
# WARN, never a failure: a repository path that does not exist; `verify: e2e | manual`;
# diagrams (counted, never rendered).
#
# Needs node (Node >= 22 is a project requirement).
# Exit 0 pass · 1 any FAIL · 3 cannot run · 64 usage.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
FOR_APPROVAL=0
NEXT_ID=0
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --for-approval) FOR_APPROVAL=1; shift ;;
    --next-id) NEXT_ID=1; shift ;;
    --root)
      [[ $# -ge 2 ]] || { echo "check-spec.sh: --root needs a path" >&2; exit 64; }
      ROOT="$2"; shift 2 ;;
    -*) echo "check-spec.sh: unknown argument $1" >&2; exit 64 ;;
    *) FILES+=("$1"); shift ;;
  esac
done

[[ -n "$ROOT" && -d "$ROOT" ]] || { echo "check-spec.sh: not inside the repository" >&2; exit 3; }
command -v node >/dev/null 2>&1 || { echo "check-spec.sh: needs node" >&2; exit 3; }
if [[ "$NEXT_ID" == 0 && ${#FILES[@]} -eq 0 ]]; then
  echo "usage: check-spec.sh [--for-approval] [--root <dir>] <spec.md>… | --next-id" >&2
  exit 64
fi

exec node - "$ROOT" "$FOR_APPROVAL" "$NEXT_ID" ${FILES[@]+"${FILES[@]}"} <<'JS'
const fs = require('fs');
const path = require('path');

const [rootArg, forApprovalArg, nextIdArg, ...files] = process.argv.slice(2);
const root = fs.realpathSync(rootArg);
const forApproval = forApprovalArg === '1';

const FOLDERS = ['specs', 'server/specs', 'client/specs', 'reviewer-core/specs', 'mcp/specs'];
const SECTIONS = [
  'Problem and user', 'Goals / Non-goals', 'User stories', 'Acceptance criteria (EARS)',
  'Edge cases', 'Non-functional requirements', 'Module interactions', 'Design review',
  'Inputs and provenance', 'Untrusted inputs', 'Traceability', 'Open questions',
];
const ITEM_HOME = {
  G: 'Goals / Non-goals', NG: 'Goals / Non-goals', US: 'User stories',
  AC: 'Acceptance criteria (EARS)', EC: 'Edge cases', NFR: 'Non-functional requirements',
  OQ: 'Open questions',
};
const ROW_HOME = {
  MI: 'Module interactions', DR: 'Design review', IN: 'Inputs and provenance',
  UI: 'Untrusted inputs',
};
const MAY_BE_NONE = ['Edge cases', 'Non-functional requirements', 'Module interactions', 'Design review',
  'Untrusted inputs', 'Open questions'];
const TAG_KEYWORD = { 'event-driven': 'WHEN', 'state-driven': 'WHILE', unwanted: 'IF', optional: 'WHERE' };
const TAGS = ['ubiquitous', ...Object.keys(TAG_KEYWORD)];
const RINGS = ['unit', 'integration', 'component', 'e2e', 'manual'];
const NFR_CATEGORIES = ['performance', 'cost', 'security', 'accessibility', 'i18n', 'observability', 'compatibility'];
const DR_KINDS = ['missing state', 'corner case', 'inconsistency', 'module', 'ux'];
const IN_KINDS = ['user text', 'user answer', 'figma export', 'code', 'repository', 'research'];
const ORIGINS = ['stated', 'design', 'code', 'research', 'assumed'];
const PACKAGES = ['server', 'client', 'reviewer-core', 'mcp', 'e2e', 'tooling'];
const VAGUE = ['should', 'may', 'might', 'can', 'could', 'etc', 'and/or', 'as appropriate',
  'as needed', 'properly', 'fast', 'quickly', 'user-friendly'];
const REQUIREMENT_FAMILIES = ['G', 'NG', 'US', 'AC', 'EC', 'NFR'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const VAGUE_RE = VAGUE.map((w) => [w, new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(w)}(?![A-Za-z0-9_-])`)]);
const MARKER_RE = /\[NEEDS CLARIFICATION:\s*\S[^\]\n]*?\s*→\s*(OQ-\d+)\s*\]/g;
const plain = (s) => s.replace(MARKER_RE, ' ').replace(/`[^`]*`/g, ' ').replace(/"[^"]*"|“[^”]*”/g, ' ');
const idsIn = (s, families) => s.match(new RegExp(`\\b(?:${families.join('|')})-\\d+\\b`, 'g')) || [];

function allSpecIds() {
  const out = [];
  for (const dir of FOLDERS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      const file = path.join(abs, name);
      if (!name.endsWith('.md') || !fs.statSync(file).isFile()) continue;
      const m = /^Spec ID: SPEC-(\d+)\s*$/m.exec(fs.readFileSync(file, 'utf8'));
      if (m) out.push({ file: `${dir}/${name}`, n: Number(m[1]) });
    }
  }
  return out;
}

if (nextIdArg === '1') {
  const highest = allSpecIds().reduce((max, s) => Math.max(max, s.n), 0);
  console.log(`SPEC-${String(highest + 1).padStart(2, '0')}`);
  process.exit(0);
}

function expandIds(cell) {
  const text = cell.trim();
  const ids = [];
  const bad = [];
  if (text === '' || text === '—' || text === '-' || /^none$/i.test(text)) return { ids, bad };
  for (const raw of text.split(',')) {
    const tok = raw.trim();
    if (!tok) continue;
    if (/^[A-Z]+-\d+$/.test(tok)) { ids.push(tok); continue; }
    const m = /^([A-Z]+)-(\d+)\s*(?:…|\.{2,3}|–|—)\s*([A-Z]+)-(\d+)$/.exec(tok);
    if (m && m[1] === m[3] && Number(m[4]) >= Number(m[2])) {
      for (let i = Number(m[2]); i <= Number(m[4]); i += 1) ids.push(`${m[1]}-${i}`);
      continue;
    }
    bad.push(tok);
  }
  return { ids, bad };
}

function parseItems(lines) {
  const items = [];
  const malformed = [];
  let cur = null;
  for (const line of lines) {
    const m = /^- \*\*([A-Z]+)-(\d+)\*\*\s+(\S.*)$/.exec(line);
    if (m) {
      cur = { fam: m[1], id: `${m[1]}-${m[2]}`, text: m[3].trim() };
      items.push(cur);
    } else if (/^- \*\*/.test(line)) {
      malformed.push(line.trim());
      cur = null;
    } else if (cur && /^\s{2,}\S/.test(line)) {
      cur.text += ` ${line.trim()}`;
    } else {
      cur = null;
    }
  }
  return { items, malformed };
}

function parseRows(lines) {
  return lines
    .filter((l) => /^\|/.test(l))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-{3,}:?$/.test(c)));
}

function check(fileArg) {
  const fails = [];
  const warns = [];
  const fail = (m) => fails.push(m);
  const warn = (m) => warns.push(m);

  const given = path.resolve(fileArg);
  if (!fs.existsSync(given) || !fs.statSync(given).isFile()) {
    return { rel: fileArg, fails: ['no such file'], warns, summary: '' };
  }
  const rel = path.relative(root, fs.realpathSync(given)).split(path.sep).join('/');
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel);

  if (!FOLDERS.includes(dir)) fail(`folder: \`${dir}\` is not a spec folder (${FOLDERS.join(', ')})`);
  const nm = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(base);
  if (!nm) {
    fail('file name: expected <YYYY-MM-DD>-<feature-slug>.md, the slug in kebab-case');
  } else {
    const d = new Date(`${nm[1]}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== nm[1]) fail(`file name: ${nm[1]} is not a real date`);
  }

  const raw = fs.readFileSync(given, 'utf8').split(/\r?\n/);
  const lines = [];
  let inFence = false;
  let diagrams = 0;
  for (const line of raw) {
    if (/^\s*```/.test(line)) {
      if (!inFence && /^\s*```mermaid\b/.test(line)) diagrams += 1;
      inFence = !inFence;
      lines.push('');
    } else {
      lines.push(inFence ? '' : line);
    }
  }
  if (inFence) fail('a code fence is never closed');

  // ---- header
  const firstSection = lines.findIndex((l) => /^## /.test(l));
  const header = lines.slice(0, firstSection === -1 ? lines.length : firstSection);
  if (!/^# Spec: \S/.test(header[0] || '') || /[<>]/.test(header[0] || '')) fail('header: line 1 must be `# Spec: <feature name>`');
  const field = (name) => {
    const hits = header.filter((l) => l.startsWith(`${name}: `) || l === `${name}:`);
    if (hits.length !== 1) { fail(`header: exactly one \`${name}:\` line expected, found ${hits.length}`); return ''; }
    const value = hits[0].slice(name.length + 1).trim();
    if (!value) fail(`header: \`${name}:\` is empty`);
    return value;
  };
  const specId = field('Spec ID');
  const status = field('Status');
  const supersedes = field('Supersedes');
  if (specId && !/^SPEC-\d{2,}$/.test(specId)) fail(`header: Spec ID \`${specId}\` is not SPEC-NN`);
  if (status && !['draft', 'approved', 'implemented'].includes(status)) fail(`header: Status \`${status}\` is not one of draft, approved, implemented`);
  if (/[<>|]/.test(supersedes)) fail('header: Supersedes must name a spec or read `none`');
  if (/^SPEC-\d{2,}$/.test(specId)) {
    const n = Number(specId.slice(5));
    const twins = allSpecIds().filter((s) => s.n === n && s.file !== rel);
    if (twins.length) fail(`header: ${specId} is already used by ${twins.map((t) => t.file).join(', ')}`);
  }

  // ---- sections
  const found = [];
  const body = {};
  let current = null;
  lines.forEach((line, i) => {
    if (i < firstSection || firstSection === -1) return;
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) { current = m[1]; found.push(current); body[current] = body[current] || []; return; }
    if (current) body[current].push(line);
  });
  for (const name of SECTIONS) if (!found.includes(name)) fail(`sections: \`## ${name}\` is missing`);
  for (const name of found) if (!SECTIONS.includes(name)) fail(`sections: \`## ${name}\` is not in the template`);
  const order = found.filter((n) => SECTIONS.includes(n));
  if (order.join('|') !== SECTIONS.filter((n) => order.includes(n)).join('|') || new Set(order).size !== order.length) {
    fail('sections: not in the template order, or a heading is repeated');
  }
  const sec = (name) => body[name] || [];
  const isNone = (name) => sec(name).some((l) => /^None — \S/.test(l));
  for (const name of SECTIONS) {
    if (!found.includes(name)) continue;
    if (!sec(name).some((l) => l.trim() !== '')) fail(`sections: \`## ${name}\` is empty — write the content, or \`None — <why>\``);
    if (isNone(name) && !MAY_BE_NONE.includes(name)) fail(`sections: \`## ${name}\` cannot be None`);
  }

  // ---- items and rows
  const defined = new Map();
  const byFam = {};
  const define = (id, fam, where) => {
    if (defined.has(id)) fail(`ids: ${id} is defined twice`);
    defined.set(id, where);
    (byFam[fam] = byFam[fam] || []).push(id);
  };
  const itemsOf = {};
  for (const name of found) {
    const { items, malformed } = parseItems(sec(name));
    itemsOf[name] = items;
    for (const line of malformed) fail(`${name}: malformed item, expected \`- **XX-n** …\`: ${line.slice(0, 60)}`);
    for (const it of items) {
      if (ITEM_HOME[it.fam] !== name) fail(`${name}: ${it.id} does not belong in this section`);
      else define(it.id, it.fam, name);
    }
  }
  const rowsOf = {};
  for (const name of found) {
    rowsOf[name] = parseRows(sec(name));
    for (const cells of rowsOf[name]) {
      const m = /^(MI|DR|IN|UI)-\d+$/.exec(cells[0]);
      if (!m) continue;
      if (ROW_HOME[m[1]] !== name) fail(`${name}: ${cells[0]} does not belong in this section`);
      else define(cells[0], m[1], name);
    }
  }
  const has = (id) => defined.has(id);
  const count = (fam) => (byFam[fam] || []).length;
  const refs = (where, text, families) => {
    const ids = idsIn(text, families);
    for (const id of ids) if (!has(id)) fail(`${where}: refers to ${id}, which is not defined`);
    return ids;
  };
  for (const fam of ['G', 'US', 'AC', 'IN']) if (!count(fam)) fail(`ids: no ${fam}-n item — a spec has at least one`);

  // ---- goals, stories
  for (const it of itemsOf['Goals / Non-goals'] || []) {
    if (it.fam === 'NG' && !/ — \S/.test(it.text)) fail(`${it.id}: a non-goal ends with \` — <why>\``);
  }
  for (const it of itemsOf['User stories'] || []) {
    if (!/\bAs an? .+ I want .+ so that .+/i.test(it.text)) fail(`${it.id}: expected "As a <role>, I want <capability>, so that <benefit>."`);
  }

  // ---- acceptance criteria
  const acCovers = {};
  const softRings = [];
  for (const it of itemsOf['Acceptance criteria (EARS)'] || []) {
    const m = /^\[([^\]]+)\]\s+(.*?)\s+—\s+covers:\s*(.*?)\s+·\s+verify:\s*(.*)$/.exec(it.text);
    if (!m) { fail(`${it.id}: expected \`[<pattern>] <sentence> — covers: US-n · verify: <ring> — <what is observed>\``); continue; }
    const tags = m[1].split('+').map((t) => t.trim());
    const sentence = plain(m[2]);
    for (const t of tags) if (!TAGS.includes(t)) fail(`${it.id}: unknown pattern \`${t}\` (${TAGS.join(', ')})`);
    if (tags.includes('ubiquitous') && tags.length > 1) fail(`${it.id}: \`ubiquitous\` stands alone`);
    const shalls = (sentence.match(/\bshall\b/gi) || []).length;
    if (shalls !== 1) fail(`${it.id}: ${shalls} \`shall\` — a criterion has exactly one`);
    if (/\b(it|we|they|you|users?|the user|the developer) shall\b/i.test(sentence)) fail(`${it.id}: names an actor, not the system that responds`);
    else if (!/\b[Tt]he [^,;]+? shall\b/.test(sentence)) fail(`${it.id}: no named system — "the <system> shall …"`);
    if (/^(When|While|If|Where)\b/.test(sentence.trim())) fail(`${it.id}: EARS keywords are written in capitals`);
    for (const [tag, kw] of Object.entries(TAG_KEYWORD)) {
      const present = new RegExp(`\\b${kw}\\b`).test(sentence);
      if (tags.includes(tag) && !present) fail(`${it.id}: tagged \`${tag}\` but has no ${kw}`);
      if (!tags.includes(tag) && present) fail(`${it.id}: has ${kw} but is not tagged \`${tag}\``);
    }
    if (tags.includes('unwanted') && !/\bTHEN\b/.test(sentence)) fail(`${it.id}: IF without THEN`);
    for (const [word, re] of VAGUE_RE) if (re.test(sentence)) fail(`${it.id}: vague word \`${word}\` — make it measurable or move it to Open questions`);
    acCovers[it.id] = refs(`${it.id} covers`, m[3], ['US', 'G']);
    if (!acCovers[it.id].length) fail(`${it.id}: \`covers:\` names no US-n or G-n`);
    const v = /^(\S+)\s*(?:—\s*(\S.*))?$/.exec(m[4].trim());
    if (!v || !RINGS.includes(v[1])) fail(`${it.id}: verify ring must be one of ${RINGS.join(', ')}`);
    else {
      if (!v[2]) fail(`${it.id}: \`verify: ${v[1]}\` needs a hint — \` — <what the check observes>\``);
      if (v[1] === 'e2e' || v[1] === 'manual') softRings.push(`${it.id} (${v[1]})`);
    }
  }
  if (softRings.length) warn(`verify: ${softRings.join(', ')} — no agent writes or runs these checks; each needs its reason`);
  const coveredStories = new Set(Object.values(acCovers).flat());
  for (const us of byFam.US || []) if (!coveredStories.has(us)) fail(`${us}: no acceptance criterion covers it`);

  // ---- edge cases, non-functional
  for (const it of itemsOf['Edge cases'] || []) {
    if (!it.text.includes('→')) fail(`${it.id}: expected \`<condition> → <expected behaviour>\``);
    const m = /—\s*(covered by|open):\s*(\S.*)$/.exec(it.text);
    if (!m) { fail(`${it.id}: must end with \` — covered by: AC-n\` or \` — open: OQ-n\``); continue; }
    const ids = refs(it.id, m[2], m[1] === 'open' ? ['OQ'] : ['AC', 'NFR']);
    if (!ids.length) fail(`${it.id}: \`${m[1]}:\` names no ${m[1] === 'open' ? 'OQ-n' : 'AC-n'}`);
  }
  for (const it of itemsOf['Non-functional requirements'] || []) {
    const m = /^\[([^\]]+)\]\s+(.*?)\s+—\s+verify:\s*(\S.*)$/.exec(it.text);
    if (!m) { fail(`${it.id}: expected \`[<category>] <measurable statement> — verify: <how>\``); continue; }
    if (!NFR_CATEGORIES.includes(m[1].trim())) fail(`${it.id}: unknown category \`${m[1]}\` (${NFR_CATEGORIES.join(', ')})`);
    for (const [word, re] of VAGUE_RE) if (re.test(plain(m[2]))) fail(`${it.id}: vague word \`${word}\` — make it measurable or move it to Open questions`);
  }

  // ---- module interactions
  if (found.includes('Module interactions')) {
    const mi = sec('Module interactions');
    const pk = mi.map((l) => /^Packages:\s*(\S.*)$/.exec(l)).find(Boolean);
    if (!pk) fail('Module interactions: no `Packages:` line');
    else {
      const names = pk[1].split(',').map((p) => p.trim()).filter(Boolean);
      for (const p of names) if (!PACKAGES.includes(p)) fail(`Module interactions: unknown package \`${p}\` (${PACKAGES.join(', ')})`);
      const single = names.length === 1 && ['server', 'client', 'reviewer-core', 'mcp'].includes(names[0]);
      const home = single ? `${names[0]}/specs` : 'specs';
      if (names.length === 1 && names[0] === 'e2e') fail('Module interactions: a feature that lives only in e2e is a journey spec (e2e/specs/README.md), not this template');
      else if (FOLDERS.includes(dir) && dir !== home) fail(`placement: Packages \`${names.join(', ')}\` puts this spec in ${home}/, not ${dir}/`);
    }
    if (!mi.some((l) => /^Surfaces:\s*\S/.test(l))) fail('Module interactions: no `Surfaces:` line');
    for (const cells of rowsOf['Module interactions'] || []) {
      if (!/^MI-\d+$/.test(cells[0])) continue;
      if (cells.length !== 6) fail(`${cells[0]}: expected 6 columns, found ${cells.length}`);
      else if (!/^(yes|changes|new)\b/.test(cells[4])) fail(`${cells[0]}: \`Exists today\` starts with yes, changes or new`);
    }
  }

  // ---- design review
  if (found.includes('Design review')) {
    const dr = sec('Design review');
    const src = dr.find((l) => /^Sources reviewed:/.test(l));
    if (!src && !dr.some((l) => /^No design source was supplied/.test(l))) fail('Design review: needs `Sources reviewed: IN-n, …` or `No design source was supplied.`');
    if (src) refs('Design review sources', src, ['IN']);
    for (const cells of rowsOf['Design review'] || []) {
      if (!/^DR-\d+$/.test(cells[0])) continue;
      if (cells.length !== 5) { fail(`${cells[0]}: expected 5 columns, found ${cells.length}`); continue; }
      if (!DR_KINDS.includes(cells[1])) fail(`${cells[0]}: unknown kind \`${cells[1]}\` (${DR_KINDS.join(', ')})`);
      const d = cells[4];
      if (/^accepted → /.test(d)) { if (!refs(cells[0], d, ['AC', 'NFR', 'EC']).length) fail(`${cells[0]}: \`accepted →\` names no AC-n, NFR-n or EC-n`); }
      else if (/^open → /.test(d)) { if (!refs(cells[0], d, ['OQ']).length) fail(`${cells[0]}: \`open →\` names no OQ-n`); }
      else if (!/^rejected — \S/.test(d)) fail(`${cells[0]}: decision must be \`accepted → AC-n\`, \`rejected — <why>\` or \`open → OQ-n\``);
    }
  }

  // ---- inputs and provenance
  const seenOrigin = {};
  const assumed = [];
  for (const cells of rowsOf['Inputs and provenance'] || []) {
    if (/^IN-\d+$/.test(cells[0])) {
      if (cells.length !== 4) fail(`${cells[0]}: expected 4 columns, found ${cells.length}`);
      else if (!IN_KINDS.includes(cells[2])) fail(`${cells[0]}: unknown kind \`${cells[2]}\` (${IN_KINDS.join(', ')})`);
      continue;
    }
    if (cells[0] === '#' || cells[0] === 'Items') continue;
    if (cells.length !== 3) { fail(`Inputs and provenance: origin row needs 3 columns: ${cells.join(' | ').slice(0, 60)}`); continue; }
    const { ids, bad } = expandIds(cells[0]);
    for (const b of bad) fail(`Inputs and provenance: cannot read items \`${b}\``);
    if (!ORIGINS.includes(cells[1])) fail(`Inputs and provenance: unknown origin \`${cells[1]}\` (${ORIGINS.join(', ')})`);
    const sources = refs(`origin of ${cells[0]}`, cells[2], ['IN', 'OQ']);
    if (!sources.length) fail(`Inputs and provenance: origin of ${cells[0]} names no IN-n or OQ-n`);
    if (cells[1] === 'assumed' && !sources.some((s) => s.startsWith('OQ-'))) fail(`Inputs and provenance: ${cells[0]} is \`assumed\` and needs an open question (OQ-n)`);
    for (const id of ids) {
      if (!has(id)) fail(`Inputs and provenance: origin table refers to ${id}, which is not defined`);
      seenOrigin[id] = (seenOrigin[id] || 0) + 1;
      if (cells[1] === 'assumed') assumed.push({ id, questions: sources.filter((q) => q.startsWith('OQ-')) });
    }
  }
  for (const fam of REQUIREMENT_FAMILIES) {
    for (const id of byFam[fam] || []) {
      if (!seenOrigin[id]) fail(`Inputs and provenance: ${id} has no origin`);
      else if (seenOrigin[id] > 1) fail(`Inputs and provenance: ${id} has ${seenOrigin[id]} origins — exactly one row`);
    }
  }

  // ---- untrusted inputs
  for (const cells of rowsOf['Untrusted inputs'] || []) {
    if (!/^UI-\d+$/.test(cells[0])) continue;
    if (cells.length !== 6) { fail(`${cells[0]}: expected 6 columns, found ${cells.length}`); continue; }
    if (!refs(cells[0], cells[5], ['AC', 'NFR']).length) fail(`${cells[0]}: the rule names no AC-n or NFR-n that makes it checkable`);
  }

  // ---- traceability
  const goalRow = {};
  const anywhere = new Set();
  for (const cells of rowsOf.Traceability || []) {
    if (cells[0] === 'Goal') continue;
    if (cells.length !== 5) { fail(`Traceability: a row needs 5 columns: ${cells.join(' | ').slice(0, 60)}`); continue; }
    const parts = cells.slice(1).map(expandIds);
    for (const p of parts) for (const b of p.bad) fail(`Traceability: cannot read \`${b}\``);
    const want = ['US', 'AC', 'EC', 'NFR'];
    parts.forEach((p, i) => {
      for (const id of p.ids) {
        if (!id.startsWith(`${want[i]}-`)) fail(`Traceability: ${id} is in the ${want[i]} column`);
        else if (!has(id)) fail(`Traceability: refers to ${id}, which is not defined`);
        anywhere.add(id);
      }
    });
    if (cells[0] === '—' || cells[0] === '-') {
      if (parts[0].ids.length || parts[1].ids.length) fail('Traceability: a story or a criterion cannot sit in the `—` row — it serves a goal');
      continue;
    }
    if (!/^G-\d+$/.test(cells[0])) { fail(`Traceability: first column is a goal or \`—\`, not \`${cells[0]}\``); continue; }
    if (!has(cells[0])) fail(`Traceability: refers to ${cells[0]}, which is not defined`);
    if (goalRow[cells[0]]) fail(`Traceability: ${cells[0]} has more than one row`);
    goalRow[cells[0]] = new Set([...parts[0].ids, ...parts[1].ids]);
    if (!parts[0].ids.length || !parts[1].ids.length) fail(`Traceability: ${cells[0]} reaches no story or no criterion`);
  }
  if (found.includes('Traceability')) {
    for (const g of byFam.G || []) if (!goalRow[g]) fail(`Traceability: ${g} has no row`);
    const inGoalRows = new Set(Object.values(goalRow).flatMap((s) => [...s]));
    for (const fam of ['US', 'AC']) for (const id of byFam[fam] || []) if (!inGoalRows.has(id)) fail(`Traceability: ${id} serves no goal`);
    for (const fam of ['EC', 'NFR']) for (const id of byFam[fam] || []) if (!anywhere.has(id)) fail(`Traceability: ${id} is missing`);
    for (const [ac, covers] of Object.entries(acCovers)) {
      for (const target of covers) {
        const ok = target.startsWith('G-')
          ? goalRow[target] && goalRow[target].has(ac)
          : Object.values(goalRow).some((s) => s.has(ac) && s.has(target));
        if (!ok) fail(`Traceability: ${ac} covers ${target}, but no row holds both`);
      }
    }
  }

  // ---- open questions
  let blocking = 0;
  for (const it of itemsOf['Open questions'] || []) {
    const m = /^\[(blocking|non-blocking)\]\s+\S/.exec(it.text);
    if (!m) { fail(`${it.id}: starts with \`[blocking]\` or \`[non-blocking]\``); continue; }
    if (m[1] === 'blocking') blocking += 1;
    if (!/ — options: \S/.test(it.text)) fail(`${it.id}: needs \` — options: <a / b>\``);
    if (m[1] === 'non-blocking' && !/ — default taken: \S/.test(it.text)) fail(`${it.id}: a non-blocking question names its \` — default taken: …\``);
    const a = / — affects:\s*(\S.*)$/.exec(it.text);
    if (!a) fail(`${it.id}: needs \` — affects: <ids>\``);
    else refs(it.id, a[1], ['G', 'NG', 'US', 'AC', 'EC', 'NFR', 'MI', 'DR', 'UI']);
  }
  if (blocking && status && status !== 'draft') fail(`status: ${blocking} [blocking] question(s) open on a spec that is \`${status}\``);

  // ---- [NEEDS CLARIFICATION] markers
  const flat = lines.join('\n').replace(/\n {2,}(?=\S)/g, ' ').replace(/`\[NEEDS CLARIFICATION[^`\n]*`/g, ' ');
  const marked = [...flat.matchAll(MARKER_RE)].map((m) => m[1]);
  const opened = (flat.match(/\[NEEDS CLARIFICATION/g) || []).length;
  if (opened !== marked.length) fail(`markers: ${opened - marked.length} malformed — expected \`[NEEDS CLARIFICATION: <what is undecided> → OQ-n]\``);
  for (const id of new Set(marked)) if (!has(id)) fail(`markers: a [NEEDS CLARIFICATION] marker refers to ${id}, which is not defined`);
  if (status === 'draft') {
    const pointed = new Set(marked);
    const pointsFrom = new Map();
    for (const it of Object.values(itemsOf).flat()) {
      const here = [...it.text.matchAll(MARKER_RE)].map((m) => m[1]);
      const open = it.fam === 'EC' ? /—\s*open:\s*(\S.*)$/.exec(it.text) : null;
      if (open) here.push(...idsIn(open[1], ['OQ']));
      pointsFrom.set(it.id, here);
      for (const id of here) pointed.add(id);
    }
    for (const { id, questions } of assumed) {
      const here = pointsFrom.get(id) || [];
      if (questions.length && !questions.some((q) => here.includes(q))) fail(`${id}: \`assumed\` — its text carries no \`[NEEDS CLARIFICATION: … → ${questions[0]}]\``);
    }
    for (const cells of rowsOf['Design review'] || []) {
      if (/^DR-\d+$/.test(cells[0]) && /^open → /.test(cells[4] || '')) for (const id of idsIn(cells[4], ['OQ'])) pointed.add(id);
    }
    for (const id of byFam.OQ || []) {
      if (!pointed.has(id)) fail(`${id}: no place in the text points at it — mark what it leaves open with \`[NEEDS CLARIFICATION: … → ${id}]\``);
    }
  }
  if (forApproval) {
    if (blocking) fail(`approval: ${blocking} [blocking] question(s) still open`);
    if (status !== 'draft') fail(`approval: only a \`draft\` is approved — this one is \`${status || '?'}\``);
  }

  // ---- warnings
  const seenPath = new Set();
  for (const m of lines.join('\n').matchAll(/`([^`\n]+)`/g)) {
    const p = m[1].trim().replace(/\s+@\s+\S+$/, '').replace(/:\d+(?:-\d+)?$/, '');
    if (!/^(server|client|reviewer-core|mcp|e2e|specs|docs|scripts|\.claude)\/[A-Za-z0-9_.\/\[\]()@-]+$/.test(p) || seenPath.has(p)) continue;
    seenPath.add(p);
    if (!fs.existsSync(path.join(root, p))) warn(`path: \`${p}\` does not exist — a typo, or code that is not built yet and does not belong in a spec`);
  }
  if (diagrams) warn(`diagrams: ${diagrams}, not rendered — check nodes (20 at most) and edge labels by reading`);

  const c = (fam) => `${fam} ${count(fam)}`;
  const summary = `${specId || 'SPEC-?'} · ${status || '?'} · ${['G', 'NG', 'US', 'AC', 'EC', 'NFR', 'MI', 'DR', 'IN', 'UI'].map(c).join(' · ')} · OQ ${count('OQ')} (blocking ${blocking}) · [NEEDS CLARIFICATION] ${marked.length}`;
  return { rel, fails, warns, summary };
}

let failed = 0;
for (const file of files) {
  const r = check(file);
  for (const w of r.warns) console.log(`WARN ${r.rel}: ${w}`);
  if (r.fails.length) {
    failed += 1;
    for (const f of r.fails) console.log(`FAIL ${r.rel}: ${f}`);
  } else {
    console.log(`ok   ${r.rel} — ${r.summary}`);
  }
}
process.exit(failed ? 1 : 0);
JS
