#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';

const USAGE = `collect-run.mjs — measure one Claude Code session from its transcripts.

Usage:
  collect-run.mjs [--session <id>] [--json] [--top <n>]
  collect-run.mjs --list

  --session <id>  session to measure (default: the most recently written one)
  --list          the ten most recent sessions of this project, newest first
  --json          exact numbers as JSON instead of Markdown tables
  --top <n>       rows in the file tables (default 15)

Prints numbers and repository paths only — never transcript or brief text.
Exit codes: 0 ok · 2 transcripts not found or unreadable.`;

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (has('--help') || has('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const fail = (message) => {
  console.error(`collect-run: ${message}`);
  process.exit(2);
};

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.env.CLAUDE_PROJECT_DIR || process.cwd();
  }
}

const ROOT = repoRoot();
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const PROJECT_DIR = join(CONFIG_DIR, 'projects', ROOT.replace(/[^a-zA-Z0-9]/g, '-'));
const TOP = Number(valueOf('--top')) || 15;

if (!existsSync(PROJECT_DIR)) fail(`no transcripts for this repository under ${PROJECT_DIR}`);

function sessions() {
  return readdirSync(PROJECT_DIR)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const id = name.slice(0, -'.jsonl'.length);
      const stat = statSync(join(PROJECT_DIR, name));
      const agentsDir = join(PROJECT_DIR, id, 'subagents');
      const agents = existsSync(agentsDir)
        ? readdirSync(agentsDir).filter((f) => f.endsWith('.jsonl')).length
        : 0;
      return { id, mtime: stat.mtimeMs, bytes: stat.size, agents };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

if (has('--list')) {
  console.log('| Session | Last written (UTC) | Size | Subagents |');
  console.log('|---|---|---|---|');
  for (const s of sessions().slice(0, 10)) {
    console.log(`| ${s.id} | ${new Date(s.mtime).toISOString().slice(0, 16)} | ${Math.round(s.bytes / 1024)} kB | ${s.agents} |`);
  }
  process.exit(0);
}

const SESSION = valueOf('--session') || sessions()[0]?.id;
if (!SESSION) fail('this project has no session transcripts');
const MAIN_FILE = join(PROJECT_DIR, `${SESSION}.jsonl`);
if (!existsSync(MAIN_FILE)) fail(`session ${SESSION} has no transcript in ${PROJECT_DIR}`);

function readLines(file) {
  const out = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // a partially written last line while the session is still running
    }
  }
  return out;
}

function repoPath(path) {
  if (typeof path !== 'string' || !path) return null;
  if (!isAbsolute(path)) return path;
  const rel = relative(ROOT, path);
  return rel.startsWith('..') ? `<outside>/${basename(path)}` : rel;
}

const blocksOf = (line) => (Array.isArray(line.message?.content) ? line.message.content : []);
const isToolResult = (line) => blocksOf(line).some((b) => b.type === 'tool_result');
const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((b) => (typeof b?.text === 'string' ? b.text : '')).join(' ')
      : '';

function bashKind(command) {
  if (/check-code\.sh|check-spec\.sh|check-agents\.sh|vitest|depcruise|drizzle-kit|\btsc\b|\b(pnpm|npm|npx)\b/.test(command)) return 'check';
  if (/(^|[\s;&|(])(grep|rg|find|ls|cat|sed|head|tail|wc|awk|jq|diff)\b/.test(command)) return 'explore';
  if (/(^|[\s;&|(])git\s/.test(command)) return 'git';
  return 'other';
}

function measure(lines) {
  // One API response is written as several lines (one per content block) that share
  // message.id, and usage grows while it streams — the largest value is the final one.
  const calls = new Map();
  const tools = {};
  const bash = { explore: 0, check: 0, git: 0, other: 0 };
  const seenToolUse = new Set();
  const reads = new Map();
  const written = new Set();
  const skills = [];
  const toolUses = [];
  let errors = 0;
  let blocked = 0;
  const starts = [];
  const stamps = [];
  const work = [];
  const results = new Map();
  const shellTokens = new Set();
  let first = null;
  let last = null;
  let version = null;

  for (const line of lines) {
    const ts = line.timestamp ? Date.parse(line.timestamp) : null;
    if (ts) {
      first ??= ts;
      last = ts;
      stamps.push(ts);
    }
    version ??= line.version ?? null;

    if (line.type === 'assistant' && line.message?.id) {
      if (ts) work.push(ts);
      const u = line.message.usage ?? {};
      const call = calls.get(line.message.id) ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, model: line.message.model, ts };
      call.input = Math.max(call.input, u.input_tokens ?? 0);
      call.cacheWrite = Math.max(call.cacheWrite, u.cache_creation_input_tokens ?? 0);
      call.cacheRead = Math.max(call.cacheRead, u.cache_read_input_tokens ?? 0);
      call.output = Math.max(call.output, u.output_tokens ?? 0);
      calls.set(line.message.id, call);

      for (const block of blocksOf(line)) {
        if (block.type !== 'tool_use' || seenToolUse.has(block.id)) continue;
        seenToolUse.add(block.id);
        tools[block.name] = (tools[block.name] ?? 0) + 1;
        toolUses.push({ id: block.id, name: block.name, input: block.input ?? {}, ts });
        const path = repoPath(block.input?.file_path);
        if (block.name === 'Read' && path) reads.set(path, (reads.get(path) ?? 0) + 1);
        if ((block.name === 'Edit' || block.name === 'Write') && path) written.add(path);
        if (block.name === 'Skill' && block.input?.skill) skills.push(block.input.skill);
        if (block.name === 'Bash' && typeof block.input?.command === 'string') {
          const kind = bashKind(block.input.command);
          bash[kind] += 1;
          if (kind === 'explore') for (const token of pathTokens(block.input.command)) shellTokens.add(token);
        }
      }
    }

    if (line.type === 'user') {
      if (isToolResult(line)) {
        if (ts) work.push(ts);
        for (const block of blocksOf(line)) {
          if (block.type !== 'tool_result') continue;
          if (ts) results.set(block.tool_use_id, ts);
          if (!block.is_error) continue;
          errors += 1;
          if (/hook|guard|blocked/i.test(textOf(block.content))) blocked += 1;
        }
      } else if (ts) {
        const isString = typeof line.message?.content === 'string';
        starts.push({
          ts,
          meta: !!line.isMeta,
          origin: line.turnOrigin ?? null,
          source: line.promptSource ?? null,
          isString,
          text: isString ? line.message.content : '',
        });
      }
    }
  }

  const list = [...calls.values()];
  const context = (c) => c.input + c.cacheWrite + c.cacheRead;
  const sum = (key) => list.reduce((n, c) => n + c[key], 0);
  return {
    apiCalls: list.length,
    input: sum('input'),
    cacheWrite: sum('cacheWrite'),
    cacheRead: sum('cacheRead'),
    output: sum('output'),
    firstContext: list.length ? context(list[0]) : 0,
    peakContext: list.reduce((n, c) => Math.max(n, context(c)), 0),
    finalContext: list.length ? context(list.at(-1)) + list.at(-1).output : 0,
    models: [...new Set(list.map((c) => c.model).filter(Boolean))],
    tools,
    bash,
    toolUses,
    reads,
    written: [...written],
    skills,
    errors,
    blocked,
    starts,
    stamps,
    work,
    results,
    shellTokens,
    first,
    last,
    version,
  };
}

const PATH_TOKEN = /(?<![\w/.-])\.?[\w@[\]-]+(?:\/[\w.@[\]*{},-]+)+/g;

function pathTokens(text) {
  const tokens = new Set();
  for (const raw of text.replaceAll(`${ROOT}/`, '').match(PATH_TOKEN) ?? []) tokens.add(raw.replace(/[.,;:]+$/, ''));
  return tokens;
}

function globMatcher(token) {
  let source = '';
  let depth = 0;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === '*') {
      if (token[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else source += '[^/]*';
    } else if (ch === '{') {
      depth += 1;
      source += '(?:';
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      source += ')';
    } else if (ch === ',' && depth > 0) source += '|';
    else source += ch.replace(/[.+?^$()|[\]\\{},]/g, '\\$&');
  }
  if (depth !== 0) return null;
  try {
    return new RegExp(`^${source}(?:/.*)?$`);
  } catch {
    return null;
  }
}

const matchersOf = (tokens) => [...tokens].map(globMatcher).filter(Boolean);

// A brief usually names the plan or the spec, and that document names the files of each
// stage — a file listed there was handed to the agent, not found by it.
function documentTokens(tokens, reads) {
  const out = new Set();
  for (const token of tokens) {
    if (!/(^|\/)specs\/[^*{}]+\.md$/.test(token) || !reads.has(token)) continue;
    const file = join(ROOT, token);
    try {
      if (statSync(file).size > 1024 * 1024) continue;
      for (const inner of pathTokens(readFileSync(file, 'utf8'))) out.add(inner);
    } catch {
      continue;
    }
  }
  return out;
}

const isFile = (path) => {
  try {
    return statSync(join(ROOT, path)).isFile();
  } catch {
    return false;
  }
};

const PROTOCOL = [/(^|\/)INSIGHTS\.md$/, /(^|\/)AGENTS\.md$/, /(^|\/)CLAUDE\.md$/, /^TESTING\.md$/, /^\.claude\//];
const SHARED_LINE_MIN = 40;
const SHARED_BRIEFS_MIN = 3;

const mainLines = readLines(MAIN_FILE);
const main = measure(mainLines);

const launches = new Map();
let questionRounds = 0;
let questionsAsked = 0;
let resumes = 0;
for (const use of main.toolUses) {
  if (use.name === 'Agent') launches.set(use.id, { background: use.input.run_in_background !== false, ts: use.ts });
  if (use.name === 'SendMessage') resumes += 1;
  if (use.name === 'AskUserQuestion') {
    questionRounds += 1;
    questionsAsked += Array.isArray(use.input.questions) ? use.input.questions.length : 0;
  }
}

const turnStarts = main.starts.filter((s) => !s.meta);
const humanPrompts = turnStarts.filter((s) => s.origin !== 'task_notification' && s.source !== 'system');
const notifications = turnStarts.filter((s) => s.origin === 'task_notification').length;

const costState = mainLines.filter((l) => l.type === 'cost-state').at(-1) ?? null;

const agentsDir = join(PROJECT_DIR, SESSION, 'subagents');
const agents = [];
if (existsSync(agentsDir)) {
  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.jsonl'))) {
    const id = file.slice('agent-'.length, -'.jsonl'.length);
    let meta = {};
    try {
      meta = JSON.parse(readFileSync(join(agentsDir, `agent-${id}.meta.json`), 'utf8'));
    } catch {
      meta = {};
    }
    const m = measure(readLines(join(agentsDir, file)));
    // The first prompt and every SendMessage resume arrive as a string; a loaded skill
    // arrives as text blocks and is not a new run.
    const runs = m.starts.filter((s) => s.isString);
    const segments = runs.map((start, i) => {
      const next = runs[i + 1]?.ts ?? Infinity;
      const end = m.stamps.reduce((latest, t) => (t >= start.ts && t < next ? Math.max(latest, t) : latest), start.ts);
      return [start.ts, end];
    });

    const briefText = runs.map((r) => r.text).join('\n');
    const briefTokens = pathTokens(briefText);
    const inBrief = matchersOf(briefTokens);
    const inDocument = matchersOf(documentTokens(briefTokens, m.reads));
    const shellFiles = [...m.shellTokens].filter((token) => !m.reads.has(token) && isFile(token)).length;
    const classes = { brief: 0, document: 0, protocol: 0, discovered: 0, outside: 0 };
    const discovered = [];
    for (const path of m.reads.keys()) {
      if (path.startsWith('<outside>/')) classes.outside += 1;
      else if (inBrief.some((re) => re.test(path))) classes.brief += 1;
      else if (inDocument.some((re) => re.test(path))) classes.document += 1;
      else if (PROTOCOL.some((re) => re.test(path))) classes.protocol += 1;
      else {
        classes.discovered += 1;
        discovered.push(path);
      }
    }

    agents.push({
      id,
      type: meta.agentType ?? 'unknown',
      description: meta.description ?? '',
      shape: launches.get(meta.toolUseId)?.background === false || meta.requestShape === 'foreground' ? 'foreground' : 'background',
      runs: runs.length,
      segments,
      wallMs: segments.reduce((n, [a, b]) => n + (b - a), 0),
      briefChars: briefText.length,
      briefLines: new Set(briefText.split('\n').map((l) => l.trim()).filter((l) => l.length >= SHARED_LINE_MIN)),
      pathsNamed: briefTokens.size,
      shellFiles,
      classes,
      discovered,
      ...m,
    });
  }
}
agents.sort((a, b) => (a.first ?? 0) - (b.first ?? 0));
agents.forEach((agent, i) => {
  agent.n = i + 1;
});

const lineOwners = new Map();
for (const agent of agents) for (const line of agent.briefLines) lineOwners.set(line, (lineOwners.get(line) ?? 0) + 1);
for (const agent of agents) {
  agent.sharedChars = [...agent.briefLines].filter((line) => lineOwners.get(line) >= SHARED_BRIEFS_MIN).reduce((n, line) => n + line.length, 0);
}
const sharedLines = [...lineOwners.values()].filter((owners) => owners >= SHARED_BRIEFS_MIN).length;

const overlaps = (a, b) => a.segments.some(([s1, e1]) => b.segments.some(([s2, e2]) => s1 < e2 && s2 < e1));
for (const agent of agents) agent.parallelWith = agents.filter((o) => o !== agent && overlaps(agent, o)).map((o) => o.n);

const allSegments = agents.flatMap((a) => a.segments);
const runningAt = (t) => allSegments.filter(([s, e]) => s <= t && t < e).length;

const busy = turnStarts.map((start, i) => {
  const next = turnStarts[i + 1]?.ts ?? Infinity;
  const end = main.work.reduce((latest, t) => (t >= start.ts && t < next ? Math.max(latest, t) : latest), start.ts);
  return [start.ts, end];
});
const promptWaits = humanPrompts
  .map((prompt) => {
    const before = main.work.filter((t) => t < prompt.ts).at(-1);
    return before ? [before, prompt.ts] : null;
  })
  .filter(Boolean);
const questionWaits = main.toolUses
  .filter((use) => use.name === 'AskUserQuestion' && use.ts && main.results.has(use.id))
  .map((use) => [use.ts, main.results.get(use.id)]);
const waits = [...promptWaits, ...questionWaits];
const within = (intervals, t) => intervals.some(([s, e]) => s <= t && t < e);

let timeline = null;
let peakConcurrency = 0;
if (allSegments.length) {
  const from = Math.min(...allSegments.map(([s]) => s));
  const to = Math.max(...allSegments.map(([, e]) => e));
  const points = [...new Set([from, to, ...[...allSegments, ...busy, ...waits].flat().filter((t) => t > from && t < to)])].sort((a, b) => a - b);
  timeline = { from, to, oneAgent: 0, parallel: 0, sessionAlone: 0, waitingForUser: 0, idle: 0 };
  for (let i = 0; i < points.length - 1; i += 1) {
    const length = points[i + 1] - points[i];
    const mid = points[i] + length / 2;
    const running = runningAt(mid);
    peakConcurrency = Math.max(peakConcurrency, running);
    if (running >= 2) timeline.parallel += length;
    else if (running === 1) timeline.oneAgent += length;
    else if (within(waits, mid)) timeline.waitingForUser += length;
    else if (within(busy, mid)) timeline.sessionAlone += length;
    else timeline.idle += length;
  }
}

const sizeKb = (path) => {
  try {
    return Math.round(statSync(join(ROOT, path)).size / 1024);
  } catch {
    return null;
  }
};

const shared = new Map();
for (const agent of agents) {
  for (const [path, count] of agent.reads) {
    const row = shared.get(path) ?? { path, agents: [], reads: 0 };
    row.agents.push(agent.n);
    row.reads += count;
    shared.set(path, row);
  }
}
const sharedReads = [...shared.values()]
  .filter((row) => row.agents.length >= 3)
  .sort((a, b) => b.agents.length - a.agents.length || b.reads - a.reads)
  .slice(0, TOP)
  .map((row) => ({ ...row, kb: sizeKb(row.path) }));

const rereads = agents
  .flatMap((agent) => [...agent.reads].filter(([, count]) => count >= 3).map(([path, count]) => ({ agent: agent.n, type: agent.type, path, reads: count, kb: sizeKb(path) })))
  .sort((a, b) => b.reads - a.reads)
  .slice(0, TOP);

const found = new Map();
for (const agent of agents) {
  for (const path of agent.discovered) {
    const row = found.get(path) ?? { path, agents: [] };
    row.agents.push(agent.n);
    found.set(path, row);
  }
}
const discoveredFiles = [...found.values()]
  .filter((row) => row.agents.length >= 2)
  .sort((a, b) => b.agents.length - a.agents.length)
  .slice(0, TOP)
  .map((row) => ({ ...row, kb: sizeKb(row.path) }));

const totalsOf = (rows) => ({
  apiCalls: rows.reduce((n, r) => n + r.apiCalls, 0),
  input: rows.reduce((n, r) => n + r.input, 0),
  cacheWrite: rows.reduce((n, r) => n + r.cacheWrite, 0),
  cacheRead: rows.reduce((n, r) => n + r.cacheRead, 0),
  output: rows.reduce((n, r) => n + r.output, 0),
});
const subTotals = totalsOf(agents);
const allTotals = totalsOf([main, ...agents]);

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? { key, agents: 0, apiCalls: 0, cacheRead: 0, output: 0, wallMs: 0 };
    group.agents += 1;
    group.apiCalls += row.apiCalls;
    group.cacheRead += row.cacheRead;
    group.output += row.output;
    group.wallMs += row.wallMs ?? 0;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.cacheRead - a.cacheRead);
}
const shortModel = (model) => (model ?? 'unknown').replace(/^claude-/, '');
const byType = groupBy(agents, (a) => a.type);
const byModel = groupBy(agents, (a) => shortModel(a.models[0]));
const costByModel = Object.fromEntries(Object.entries(costState?.modelUsage ?? {}).map(([model, u]) => [shortModel(model), u.costUSD ?? null]));

const result = {
  session: SESSION,
  claudeCode: main.version,
  window: { first: main.first, last: main.last },
  main: { ...totalsOf([main]), models: main.models.map(shortModel), tools: main.tools, errors: main.errors },
  subagents: subTotals,
  all: allTotals,
  cost: costState ? { totalUsd: costState.totalCostUSD ?? null, byModel: costByModel } : null,
  counts: {
    agents: agents.length,
    agentLaunches: launches.size,
    resumes,
    humanPrompts: humanPrompts.length,
    taskNotifications: notifications,
    questionRounds,
    questionsAsked,
    peakConcurrency,
  },
  timeline,
  briefs: {
    sharedLines,
    sharedChars: agents.reduce((n, a) => n + a.sharedChars, 0),
    totalChars: agents.reduce((n, a) => n + a.briefChars, 0),
  },
  byType,
  byModel,
  agents: agents.map((a) => ({
    n: a.n,
    id: a.id,
    type: a.type,
    description: a.description,
    shape: a.shape,
    model: shortModel(a.models[0]),
    start: a.first,
    end: a.last,
    wallMs: a.wallMs,
    runs: a.runs,
    apiCalls: a.apiCalls,
    input: a.input,
    cacheWrite: a.cacheWrite,
    cacheRead: a.cacheRead,
    output: a.output,
    firstContext: a.firstContext,
    peakContext: a.peakContext,
    finalContext: a.finalContext,
    tools: a.tools,
    bash: a.bash,
    skills: a.skills,
    filesWritten: a.written.length,
    errors: a.errors,
    blocked: a.blocked,
    parallelWith: a.parallelWith,
    briefChars: a.briefChars,
    sharedChars: a.sharedChars,
    pathsNamed: a.pathsNamed,
    filesRead: a.reads.size,
    shellFiles: a.shellFiles,
    reads: a.classes,
  })),
  sharedReads,
  rereads,
  discoveredFiles,
};

if (has('--json')) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const num = (n) => {
  if (n === null || n === undefined) return 'n/a';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
};
const clock = (ms) => (ms ? new Date(ms).toISOString().slice(11, 19) : 'n/a');
const span = (ms) => {
  const s = Math.round(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};
const usd = (n) => (n == null ? 'n/a' : `$${n.toFixed(2)}`);
const table = (head, rows) => {
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  for (const row of rows) console.log(`| ${row.join(' | ')} |`);
  console.log('');
};
const NAMED_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'Skill'];
const otherTools = (tools) => Object.entries(tools).filter(([name]) => !NAMED_TOOLS.includes(name)).reduce((n, [, count]) => n + count, 0);

console.log(`# Run measurements — session ${SESSION}`);
console.log(`Source: transcripts · Claude Code ${main.version ?? 'unknown'} · session ${new Date(main.first).toISOString().slice(0, 16)} → ${new Date(main.last).toISOString().slice(0, 16)} UTC (${span(main.last - main.first)})`);
console.log('');

console.log('## Totals');
table(
  ['Scope', 'API calls', 'Input', 'Cache write', 'Cache read', 'Output'],
  [
    ['main session', result.main.apiCalls, num(result.main.input), num(result.main.cacheWrite), num(result.main.cacheRead), num(result.main.output)],
    [`subagents (${agents.length})`, subTotals.apiCalls, num(subTotals.input), num(subTotals.cacheWrite), num(subTotals.cacheRead), num(subTotals.output)],
    ['all', allTotals.apiCalls, num(allTotals.input), num(allTotals.cacheWrite), num(allTotals.cacheRead), num(allTotals.output)],
  ],
);
if (result.cost?.totalUsd != null) console.log(`Cost snapshot recorded by Claude Code (may lag the end of the session): ${usd(result.cost.totalUsd)}`);
const c = result.counts;
console.log(`Agents: ${c.agents} · Agent launches: ${c.agentLaunches} · SendMessage resumes: ${c.resumes} · peak concurrency: ${c.peakConcurrency}`);
console.log(`Human prompts that started a turn: ${c.humanPrompts} (a message sent mid-turn is not counted) · task notifications: ${c.taskNotifications} · AskUserQuestion rounds: ${c.questionRounds} (${c.questionsAsked} questions)`);
console.log('');

if (timeline) {
  console.log('## Where the time went, first agent start to last agent end');
  const total = timeline.to - timeline.from;
  const share = (ms) => `${span(ms)} (${Math.round((ms / total) * 100)}%)`;
  table(
    ['Window UTC', 'Length', 'One agent running', 'Agents in parallel', 'Session working alone', 'Waiting for the user', 'Idle'],
    [[`${clock(timeline.from)} → ${clock(timeline.to)}`, span(total), share(timeline.oneAgent), share(timeline.parallel), share(timeline.sessionAlone), share(timeline.waitingForUser), share(timeline.idle)]],
  );
}

console.log('## By agent type');
table(['Agent', 'Agents', 'API calls', 'Cache read Σ', 'Output Σ', 'Wall'], byType.map((r) => [r.key, r.agents, r.apiCalls, num(r.cacheRead), num(r.output), span(r.wallMs)]));

console.log('## By model');
table(
  ['Model', 'Agents', 'API calls', 'Cache read Σ', 'Output Σ', 'Session cost snapshot'],
  [
    ...byModel.map((r) => [r.key, r.agents, r.apiCalls, num(r.cacheRead), num(r.output), usd(costByModel[r.key])]),
    ...result.main.models.map((model) => [`${model} (main session)`, '—', result.main.apiCalls, num(result.main.cacheRead), num(result.main.output), byModel.some((r) => r.key === model) ? 'in the row above' : usd(costByModel[model])]),
  ],
);

console.log('## Agents, in launch order');
table(
  ['#', 'Agent', 'Description', 'Model', 'Shape', 'Start UTC', 'Wall', 'Runs', 'API calls', 'First ctx', 'Peak ctx', 'Cache read Σ', 'Output Σ', 'Errors (blocked)', '∥ with'],
  result.agents.map((a) => [a.n, a.type, a.description, a.model, a.shape, clock(a.start), span(a.wallMs), a.runs, a.apiCalls, num(a.firstContext), num(a.peakContext), num(a.cacheRead), num(a.output), `${a.errors} (${a.blocked})`, a.parallelWith.join(', ') || '—']),
);

console.log('## Tool calls per agent');
table(
  ['#', 'Agent', ...NAMED_TOOLS, 'other', 'Bash: explore / check / git / other', 'Files written', 'Skills loaded'],
  result.agents.map((a) => [a.n, a.type, ...NAMED_TOOLS.map((name) => a.tools[name] ?? 0), otherTools(a.tools), `${a.bash.explore} / ${a.bash.check} / ${a.bash.git} / ${a.bash.other}`, a.filesWritten, a.skills.join(', ') || '—']),
);

console.log('## Briefs against what was read');
console.log(`Brief text: ${num(result.briefs.totalChars)} chars over ${agents.length} agents; ${result.briefs.sharedLines} lines repeated in ${SHARED_BRIEFS_MIN}+ briefs account for ${num(result.briefs.sharedChars)} chars.`);
console.log('A file counts as handed over when the brief names it, or a spec or plan that the brief names and the agent read does. "Protocol" is INSIGHTS.md, AGENTS.md, TESTING.md and .claude/**. "Found alone" is everything else opened with Read. "Via shell" counts further files named in grep / sed / cat commands — they are not classified.');
console.log('');
table(
  ['#', 'Agent', 'Brief chars', 'Repeated chars', 'Paths named', 'Files read', 'In brief', 'In spec / plan', 'Protocol', 'Found alone', 'Outside repo', 'Via shell'],
  result.agents.map((a) => [a.n, a.type, num(a.briefChars), num(a.sharedChars), a.pathsNamed, a.filesRead, a.reads.brief, a.reads.document, a.reads.protocol, a.reads.discovered, a.reads.outside, a.shellFiles]),
);

console.log('## Files two or more agents found alone');
if (discoveredFiles.length) table(['File', '~kB', 'Agents', 'Which'], discoveredFiles.map((r) => [r.path, r.kb ?? 'n/a', r.agents.length, r.agents.join(', ')]));
else console.log('none\n');

console.log('## Files read by three or more agents');
if (sharedReads.length) table(['File', '~kB', 'Agents', 'Reads', 'Which'], sharedReads.map((r) => [r.path, r.kb ?? 'n/a', r.agents.length, r.reads, r.agents.join(', ')]));
else console.log('none\n');

console.log('## Files read three or more times by one agent');
if (rereads.length) table(['#', 'Agent', 'File', '~kB', 'Reads'], rereads.map((r) => [r.agent, r.type, r.path, r.kb ?? 'n/a', r.reads]));
else console.log('none\n');
