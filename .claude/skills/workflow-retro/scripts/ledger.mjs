#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const USAGE = `ledger.mjs — check a retro entry, or read the trend across entries.

Usage:
  ledger.mjs check <entry.md>      the entry against ledger-template.md; exit 1 on any FAIL
  ledger.mjs trend [--dir <dir>]   runs, findings by kind and by module, proposal targets
                                   (default dir: docs/retro/ledger)`;

const KINDS = ['cost', 'friction', 'ease', 'duplication', 'miss', 'wrong-claim', 'handoff', 'question', 'rework', 'human-load', 'conduct'];
const SECTIONS = ['Launch table', 'Measurements', 'Findings', 'Proposals', 'Earlier proposals', 'For engineering-insights', 'Not established'];
const TOTAL_KEYS = ['agents', 'launches', 'resumes', 'fix rounds', 'question rounds', 'human prompts', 'wall'];
const TOKEN_KEYS = ['cache read', 'cache write', 'output', 'cost snapshot'];
const UNIT_KEYS = ['stages', 'criteria', 'files changed'];
const PLACEHOLDERS = /<(n|module|kind|target file|YYYY-MM-DD|agent|purpose|trigger|outcome|path|name|short sha|run-slug|entry file|h:mm|m:ss)>/;
const FORBIDDEN = [
  [/(^|[\s`"'(])\/(home|Users|tmp|var|root)\//, 'an absolute path from outside the repository'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}\b/, 'an email address'],
  [/\ba[0-9a-f]{16}\b/, 'an agent id — refer to an agent by its launch-table number'],
];
const FINDING = /^- F(\d+) \[([^\]]+)\] ([a-z-]+) — (.+) Evidence: (.+) Cost: (.+)$/;
const PROPOSAL = /^- P(\d+) → `([^`]+)` — (.+) From: (F\d+(?:, F\d+)*) · Effect: (.+) · Effort: (S|M|L) · Status: proposed$/;

const [command, ...rest] = process.argv.slice(2);

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function pairs(value) {
  const out = new Map();
  for (const part of value.split(' · ')) {
    const match = part.trim().match(/^(.*\S)\s+(\S+)$/);
    if (match) out.set(match[1], match[2]);
  }
  return out;
}

const amount = (text) => {
  const match = /^\$?([\d.]+)([kM]?)$/.exec(text ?? '');
  if (!match) return null;
  return Number(match[1]) * (match[2] === 'M' ? 1e6 : match[2] === 'k' ? 1e3 : 1);
};

function parse(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const header = {};
  const sections = [];
  let current = null;
  for (const [index, line] of lines.entries()) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      current = { title: heading[1].trim(), lines: [], at: index + 1 };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else {
      const field = /^(Date|Run|Mode|Totals|Tokens|Units|Outcome):\s*(.*)$/.exec(line);
      if (field) header[field[1]] = field[2].trim();
    }
  }
  const section = (title) => sections.find((s) => s.title === title);
  const findings = (section('Findings')?.lines ?? []).filter((l) => l.startsWith('- ')).map((l) => ({ line: l, match: FINDING.exec(l) }));
  const proposals = (section('Proposals')?.lines ?? []).filter((l) => l.startsWith('- ')).map((l) => ({ line: l, match: PROPOSAL.exec(l) }));
  return { file, lines, header, sections, section, findings, proposals };
}

function check(file) {
  if (!file || !existsSync(file)) {
    console.error(`ledger: no such entry: ${file ?? '(none given)'}`);
    process.exit(2);
  }
  const root = repoRoot();
  const entry = parse(file);
  const fails = [];
  const warns = [];
  const { header } = entry;

  if (!/^# Retro: \S/.test(entry.lines[0] ?? '')) fails.push('line 1 must be `# Retro: <name>`');

  const name = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(basename(file));
  if (!name) fails.push('file name must be <YYYY-MM-DD>-<run-slug>.md, the slug in kebab-case');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.Date ?? '')) fails.push('`Date:` must be YYYY-MM-DD');
  else if (name && name[1] !== header.Date) fails.push(`\`Date: ${header.Date}\` differs from the file name's ${name[1]}`);

  for (const field of ['Run', 'Outcome']) if (!header[field]) fails.push(`\`${field}:\` is missing or empty`);
  if (!['in-context', 'deep'].includes(header.Mode)) fails.push('`Mode:` must be `in-context` or `deep`');

  const totals = pairs(header.Totals ?? '');
  for (const key of TOTAL_KEYS) {
    const value = totals.get(key);
    if (value === undefined) fails.push(`\`Totals:\` lacks \`${key}\``);
    else if (key === 'wall' ? !/^(\d+:\d{2}|n\/a)$/.test(value) : !/^(\d+|n\/a)$/.test(value)) fails.push(`\`Totals:\` ${key} is \`${value}\` — expected ${key === 'wall' ? 'h:mm' : 'a whole number'} or n/a`);
  }

  if (header.Mode === 'deep') {
    const tokens = pairs(header.Tokens ?? '');
    for (const key of TOKEN_KEYS) {
      const value = tokens.get(key);
      if (value === undefined) fails.push(`\`Tokens:\` lacks \`${key}\` (a deep entry carries all four)`);
      else if (value !== 'n/a' && amount(value) === null) fails.push(`\`Tokens:\` ${key} is \`${value}\` — expected a number such as 80.5M, 939k or $52.56`);
    }
  } else if (header.Mode === 'in-context' && header.Tokens !== 'n/a (deep)') {
    fails.push('`Tokens:` of an in-context entry must be `n/a (deep)` — `subagent_tokens` is not a cost');
  }

  const units = pairs(header.Units ?? '');
  for (const key of UNIT_KEYS) {
    const value = units.get(key);
    if (value === undefined) fails.push(`\`Units:\` lacks \`${key}\``);
    else if (!(key === 'criteria' ? /^(\d+\/\d+|n\/a)$/ : /^(\d+|n\/a)$/).test(value)) fails.push(`\`Units:\` ${key} is \`${value}\` — expected ${key === 'criteria' ? 'done/total' : 'a whole number'} or n/a`);
  }

  const titles = entry.sections.map((s) => s.title);
  let cursor = -1;
  for (const title of SECTIONS) {
    const at = titles.indexOf(title);
    if (at < 0) fails.push(`section \`## ${title}\` is missing`);
    else if (at < cursor) fails.push(`section \`## ${title}\` is out of order`);
    else cursor = at;
  }

  const rows = (entry.section('Launch table')?.lines ?? []).filter((l) => /^\|\s*\d+\s*\|/.test(l)).length;
  if (rows < 2) fails.push('the launch table needs at least two rows — fewer is not a multi-agent run');
  const expected = Number(totals.get('launches')) + Number(totals.get('resumes'));
  if (Number.isFinite(expected) && rows !== expected) warns.push(`launch table has ${rows} rows, \`Totals:\` says ${expected} (launches + resumes)`);

  const seen = new Set();
  for (const [index, finding] of entry.findings.entries()) {
    if (!finding.match) {
      fails.push(`finding is not in the line format: ${finding.line.slice(0, 70)}…`);
      continue;
    }
    const [, number, , kind] = finding.match;
    if (Number(number) !== index + 1) fails.push(`F${number} is out of sequence (expected F${index + 1})`);
    if (!KINDS.includes(kind)) fails.push(`F${number}: kind \`${kind}\` is not one of ${KINDS.join(', ')}`);
    seen.add(`F${number}`);
  }
  if (!entry.findings.length) warns.push('no findings — say so under "Not established" if the run really left none');

  let heading = null;
  for (const line of entry.section('Findings')?.lines ?? []) {
    const sub = /^### (.+)$/.exec(line);
    if (sub) heading = sub[1].trim();
    const match = FINDING.exec(line);
    if (match && heading && match[2] !== heading) warns.push(`F${match[1]} is tagged [${match[2]}] under the heading \`### ${heading}\``);
  }

  if (entry.proposals.length > 7) fails.push(`${entry.proposals.length} proposals — at most seven`);
  for (const [index, proposal] of entry.proposals.entries()) {
    if (!proposal.match) {
      fails.push(`proposal is not in the line format: ${proposal.line.slice(0, 70)}…`);
      continue;
    }
    const [, number, target, , from] = proposal.match;
    if (Number(number) !== index + 1) fails.push(`P${number} is out of sequence (expected P${index + 1})`);
    for (const ref of from.split(', ')) if (!seen.has(ref)) fails.push(`P${number} cites ${ref}, which is not a finding of this entry`);
    if (!existsSync(join(root, target))) warns.push(`P${number} targets \`${target}\`, which does not exist — a new file, or a wrong path`);
  }
  const body = entry.section('Proposals')?.lines.join('\n') ?? '';
  if (entry.proposals.length) {
    const first = /First to take: P(\d+)/.exec(body);
    if (!first) fails.push('`First to take: P<n> — <why>` is missing under Proposals');
    else if (Number(first[1]) > entry.proposals.length) fails.push(`\`First to take: P${first[1]}\` names a proposal that is not there`);
  }

  for (const title of ['Earlier proposals', 'For engineering-insights', 'Not established']) {
    const section = entry.section(title);
    if (section && !section.lines.some((l) => l.trim() && !l.startsWith('('))) fails.push(`\`## ${title}\` is empty — write the lines or \`none\``);
  }

  for (const [index, line] of entry.lines.entries()) {
    if (PLACEHOLDERS.test(line)) fails.push(`line ${index + 1}: a template placeholder was left in`);
    if (line.includes('<!--')) fails.push(`line ${index + 1}: a template comment was left in`);
    for (const [pattern, what] of FORBIDDEN) if (pattern.test(line)) fails.push(`line ${index + 1}: ${what}`);
  }

  for (const message of fails) console.log(`FAIL ${file}: ${message}`);
  for (const message of warns) console.log(`WARN ${file}: ${message}`);
  if (fails.length) process.exit(1);
  const byKind = KINDS.map((kind) => [kind, entry.findings.filter((f) => f.match?.[3] === kind).length]).filter(([, count]) => count);
  console.log(`ok   ${file} — ${header.Mode} · F ${entry.findings.length} (${byKind.map(([kind, count]) => `${kind} ${count}`).join(', ') || 'none'}) · P ${entry.proposals.length}`);
}

function trend(dir) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f)).sort() : [];
  if (!files.length) {
    console.log(`no entries yet in ${dir}`);
    return;
  }
  const entries = files.map((f) => ({ name: f.replace(/\.md$/, ''), ...parse(join(dir, f)) }));
  const table = (head, rows) => {
    console.log(`| ${head.join(' | ')} |`);
    console.log(`|${head.map(() => '---').join('|')}|`);
    for (const row of rows) console.log(`| ${row.join(' | ')} |`);
    console.log('');
  };
  const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

  console.log(`# Retro trend — ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}\n`);
  console.log('## Runs');
  table(
    ['Entry', 'Mode', 'Agents', 'Launches', 'Resumes', 'Fix rounds', 'Question rounds', 'Human prompts', 'Wall', 'Cache read', 'Output', 'Cost', 'Findings', 'Proposals'],
    entries.map((e) => {
      const totals = pairs(e.header.Totals ?? '');
      const tokens = pairs(e.header.Tokens ?? '');
      const cell = (map, key) => map.get(key) ?? 'n/a';
      return [e.name, e.header.Mode ?? '?', ...TOTAL_KEYS.map((key) => cell(totals, key)), cell(tokens, 'cache read'), cell(tokens, 'output'), cell(tokens, 'cost snapshot'), e.findings.length, e.proposals.length];
    }),
  );

  const perUnit = entries
    .map((e) => {
      const read = amount(pairs(e.header.Tokens ?? '').get('cache read'));
      const units = pairs(e.header.Units ?? '');
      const stages = Number(units.get('stages'));
      const criteria = Number((units.get('criteria') ?? '').split('/')[0]);
      const changed = Number(units.get('files changed'));
      if (read === null) return null;
      const per = (count) => (Number.isFinite(count) && count > 0 ? short(read / count) : 'n/a');
      return [e.name, per(stages), per(criteria), per(changed)];
    })
    .filter(Boolean);
  if (perUnit.length) {
    console.log('## Cache-read tokens per unit of result (deep entries)');
    table(['Entry', 'Per stage', 'Per criterion done', 'Per file changed'], perUnit);
  }

  console.log('## Findings by kind');
  table(['Entry', ...KINDS], entries.map((e) => [e.name, ...KINDS.map((kind) => e.findings.filter((f) => f.match?.[3] === kind).length)]));

  const tally = (items) => {
    const map = new Map();
    for (const [key, entry] of items) {
      const row = map.get(key) ?? { key, count: 0, entries: new Set() };
      row.count += 1;
      row.entries.add(entry);
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.entries.size - a.entries.size || b.count - a.count);
  };

  console.log('## Findings by module, all entries');
  table(['Module', 'Findings', 'Entries'], tally(entries.flatMap((e) => e.findings.filter((f) => f.match).map((f) => [f.match[2], e.name]))).map((r) => [r.key, r.count, r.entries.size]));

  console.log('## Proposal targets, all entries');
  const targets = tally(entries.flatMap((e) => e.proposals.filter((p) => p.match).map((p) => [p.match[2], e.name])));
  if (targets.length) table(['Target', 'Proposals', 'Entries'], targets.map((r) => [`\`${r.key}\``, r.count, r.entries.size]));
  else console.log('none\n');

  const recurring = entries.flatMap((e) => (e.section('Earlier proposals')?.lines ?? []).filter((l) => /recurring ×|it recurred/.test(l)).map((l) => `- ${e.name}: ${l.replace(/^- /, '')}`));
  console.log('## Came back');
  console.log(recurring.length ? recurring.join('\n') : 'nothing yet');
}

if (command === 'check') check(rest[0]);
else if (command === 'trend') {
  const at = rest.indexOf('--dir');
  trend(at >= 0 ? rest[at + 1] : join(repoRoot(), 'docs/retro/ledger'));
} else {
  console.log(USAGE);
  process.exit(command ? 2 : 0);
}
