import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PrBriefAnswer,
  type BlastRadius,
  type Intent,
  type LLMProvider,
  type SmartDiffRole,
  type StructuredRequest,
} from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { TiktokenTokenizer } from '../src/adapters/tokenizer/index.js';
import { AppError, ConfigError, NotFoundError } from '../src/platform/errors.js';
import type { PromptLog } from '../src/platform/prompt-log.js';
import { loadPromptTemplate } from '../src/platform/prompts.js';
import {
  BRIEF_INPUT_BUDGET_TOKENS,
  BRIEF_MAX_RETRIES,
  BRIEF_MAX_TOKENS,
  BRIEF_MODEL_DEADLINE_MS,
  BRIEF_SCHEMA_NAME,
} from '../src/modules/brief/constants.js';
import { BriefService } from '../src/modules/brief/service.js';
import type {
  BriefDeps,
  BriefPullFile,
  BriefPullRecord,
  BriefStore,
  StoredBrief,
} from '../src/modules/brief/types.js';
import { defaultFeatureModel } from '../src/modules/settings/feature-models.js';

const tokenizer = new TiktokenTokenizer();
const count = (text: string): number => tokenizer.count(text);
const MODEL = defaultFeatureModel('risk_brief');

const PULL: BriefPullRecord = {
  id: 'pr-1',
  repoId: 'repo-1',
  title: 'TITLE-MARKER-4e1 throttle logins',
  body: 'BODY-MARKER-8b3 adds a limiter',
  headSha: 'sha-head',
};

const PATCH = [
  '@@ -10,3 +10,5 @@ HEADER-TAIL-MARKER-d41 function login() {',
  ' CONTEXT-LINE-MARKER-9be',
  '-REMOVED-LINE-MARKER-1a8',
  '+ADDED-LINE-MARKER-6c2',
  '+  more();',
  ' }',
  '@@ -40,2 +42,3 @@',
  ' keep();',
  '+added();',
  ' end();',
].join('\n');

const FILES: BriefPullFile[] = [
  { path: 'src/auth/login.ts', additions: 4, deletions: 1, patch: PATCH },
  { path: 'src/auth/login.test.ts', additions: 6, deletions: 0, patch: '@@ -0,0 +1,6 @@\n+a' },
  { path: 'docs/notes.md', additions: 2, deletions: 0, patch: null },
];

const INTENT_RECORD = {
  intent: 'INTENT-SENTENCE-MARKER-2d9 throttle login attempts',
  in_scope: ['login throttling'],
  out_of_scope: ['signup'],
  risk_areas: ['auth'],
  confidence: 'high',
};

const BLAST = {
  changed_symbols: [{ name: 'login', file: 'src/auth/login.ts', kind: 'function' }],
  downstream: [
    {
      symbol: 'login',
      callers: [{ name: 'handler', file: 'src/api/session.ts', line: 12 }],
      endpoints_affected: ['POST /session'],
      crons_affected: [],
    },
  ],
  summary: 'BLAST-SUMMARY-MARKER-5f0 one symbol reaches one caller',
  totals: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
  degraded: false,
};

const DOCS = [
  { path: 'specs/auth.md', text: 'DOC-ONE-MARKER-71c the auth spec.' },
  { path: 'docs/limits.md', text: 'DOC-TWO-MARKER-0aa the limits.' },
];

const ANSWER: PrBriefAnswer = {
  summary: 'Adds login throttling.',
  risks: [
    {
      kind: 'security',
      title: 'Lockout bypass',
      explanation: 'The counter resets on restart.',
      severity: 'high',
      file_refs: ['src/auth/login.ts'],
    },
  ],
  review_focus: [{ file: 'src/auth/login.ts', line: 11, reason: 'Check the counter reset.' }],
};

const MIXED: PrBriefAnswer = {
  summary: '  Mixed answer.  ',
  risks: [
    {
      kind: 'security',
      title: 'Kept',
      explanation: 'e',
      severity: 'high',
      file_refs: ['src/auth/login.ts', 'src/invented/ghost.ts', 'src/api/session.ts'],
    },
    { kind: 'data', title: '   ', explanation: 'e', severity: 'low', file_refs: ['src/auth/login.ts'] },
    {
      kind: 'x',
      title: 'Only invented',
      explanation: 'e',
      severity: 'medium',
      file_refs: ['src/invented/ghost.ts'],
    },
    { kind: 'x', title: 'No refs', explanation: 'e', severity: 'medium', file_refs: [] },
  ],
  review_focus: [
    { file: 'src/auth/login.ts', line: 42, reason: 'second hunk' },
    { file: 'src/auth/login.ts', line: 20, reason: 'outside every changed range' },
    { file: 'src/invented/ghost.ts', line: 1, reason: 'not a file of the PR' },
    { file: 'src/api/session.ts', line: 12, reason: 'a caller, not a changed file' },
    { file: 'src/auth/login.ts', line: 10, reason: '  ' },
    { file: 'src/auth/login.test.ts', line: 3, reason: 'tests' },
  ],
};

const MARKERS = [
  'TITLE-MARKER',
  'BODY-MARKER',
  'INTENT-SENTENCE-MARKER',
  'BLAST-SUMMARY-MARKER',
  'DOC-ONE-MARKER',
  'DOC-TWO-MARKER',
  'ADDED-LINE-MARKER',
  'CONTEXT-LINE-MARKER',
  'REMOVED-LINE-MARKER',
  'HEADER-TAIL-MARKER',
];

class MemoryStore implements BriefStore {
  rows = new Map<string, StoredBrief>();
  upserts: StoredBrief[] = [];

  async get(prId: string): Promise<StoredBrief | undefined> {
    return this.rows.get(prId);
  }

  async upsert(prId: string, brief: StoredBrief): Promise<void> {
    this.upserts.push(brief);
    this.rows.set(prId, brief);
  }
}

function storedBrief(over: Partial<StoredBrief> = {}): StoredBrief {
  return {
    pr_id: PULL.id,
    head_sha: 'sha-old',
    summary: 'Older summary.',
    risks: { risks: [] },
    review_focus: [],
    intent: null,
    blast: null,
    provider: 'openrouter',
    model: 'older-model',
    tokens_in: 1,
    tokens_out: 2,
    cost_usd: null,
    documents_read: [],
    ...over,
  };
}

function stubProvider(completeStructured: LLMProvider['completeStructured']): LLMProvider {
  return {
    id: 'openrouter',
    listModels: async () => [],
    complete: async () => {
      throw new Error('complete is not used by the brief');
    },
    embed: async () => [],
    completeStructured,
  };
}

interface Logged {
  obj: Record<string, unknown>;
  msg?: string;
}

interface Over {
  pull?: BriefPullRecord | undefined;
  files?: BriefPullFile[];
  intent?: Intent | null;
  blast?: BlastRadius;
  documents?: { path: string; text: string }[];
  answer?: unknown;
  provider?: LLMProvider;
  llm?: BriefDeps['llm'];
  stored?: StoredBrief;
  promptMode?: PromptLog['mode'];
}

function build(over: Over = {}) {
  const store = new MemoryStore();
  if (over.stored) store.rows.set(PULL.id, over.stored);
  const mock = new MockLLMProvider('openai', { structured: over.answer ?? ANSWER });
  const provider: LLMProvider = over.provider ?? mock;
  const lines: Logged[] = [];
  const capture = (obj: unknown, msg?: string): void => {
    lines.push({ obj: obj as Record<string, unknown>, msg });
  };

  const pulls = {
    getById: vi.fn(async (_workspaceId: string, _prId: string) =>
      'pull' in over ? over.pull : PULL,
    ),
    listFiles: vi.fn(async (_prId: string) => over.files ?? FILES),
  };
  const intent = {
    getForPull: vi.fn(async (_workspaceId: string, _prId: string) => ({
      intent: 'intent' in over ? (over.intent ?? null) : INTENT_RECORD,
    })),
  };
  const blast = { forPull: vi.fn(async (_workspaceId: string, _prId: string) => over.blast ?? BLAST) };
  const context = {
    resolveForWorkspace: vi.fn(
      async (_workspaceId: string, _repoId: string) => over.documents ?? DOCS,
    ),
  };
  const roles = {
    classify: vi.fn(
      (path: string): SmartDiffRole =>
        path.endsWith('.md') ? 'docs' : path.endsWith('.test.ts') ? 'tests' : 'core',
    ),
  };
  const llm = vi.fn(over.llm ?? (async () => provider));

  const deps: BriefDeps = {
    store,
    pulls,
    intent,
    blast,
    context,
    roles,
    settingsRepo: { listForWorkspace: async () => [] },
    tokenizer,
    llm,
    promptLog: () => ({ mode: over.promptMode ?? 'summary', sink: { info: capture } }),
    log: { info: capture },
  };
  return {
    service: new BriefService(deps),
    store,
    mock,
    lines,
    pulls,
    intent,
    blast,
    context,
    roles,
    llm,
  };
}

function structuredCalls(mock: MockLLMProvider): StructuredRequest<unknown>[] {
  return mock.calls
    .filter((call) => call.method === 'completeStructured')
    .map((call) => call.req as StructuredRequest<unknown>);
}

function inputOf(req: StructuredRequest<unknown>): string {
  return req.messages.map((message) => message.content).join('\n');
}

function userOf(req: StructuredRequest<unknown>): string {
  return req.messages.find((message) => message.role === 'user')!.content;
}

function byEvent(lines: Logged[], event: string): Logged[] {
  return lines.filter((line) => line.obj.event === event);
}

function sectionNames(line: Logged): string[] {
  return (line.obj.sections as { name: string }[]).map((section) => section.name);
}

let system = '';
beforeAll(async () => {
  system = await loadPromptTemplate('brief.system.md');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BriefService.generate — the model call', () => {
  it('makes one structured call against the shared answer schema, with the one re-ask', async () => {
    const t = build();

    await t.service.generate('ws-1', PULL.id, 'corr-1');

    expect(t.mock.calls).toHaveLength(1);
    const [req] = structuredCalls(t.mock);
    expect(req).toBeDefined();
    expect(req!.schema).toBe(PrBriefAnswer);
    expect(req!.schemaName).toBe(BRIEF_SCHEMA_NAME);
    expect(req!.model).toBe(MODEL.model);
    expect(req!.maxRetries).toBe(BRIEF_MAX_RETRIES);
    expect(BRIEF_MAX_RETRIES).toBe(1);
    expect(req!.maxTokens).toBe(BRIEF_MAX_TOKENS);
    expect(req!.temperature).toBe(0);
    expect(req!.messages.map((message) => message.role)).toEqual(['system', 'user']);
  });

  it('asks for a summary of at least one non-blank character and a line of at least 1', async () => {
    const t = build();
    await t.service.generate('ws-1', PULL.id, 'corr-1');
    const schema = structuredCalls(t.mock)[0]!.schema;

    const full = {
      summary: 'ok',
      risks: [
        {
          kind: 'security',
          title: 't',
          explanation: 'e',
          severity: 'high',
          file_refs: ['src/auth/login.ts'],
        },
      ],
      review_focus: [{ file: 'src/auth/login.ts', line: 1, reason: 'r' }],
    };
    const { summary: _omitted, ...withoutSummary } = full;

    expect(schema.safeParse(full).success).toBe(true);
    expect(schema.safeParse(withoutSummary).success).toBe(false);
    expect(schema.safeParse({ ...full, summary: '' }).success).toBe(false);
    expect(schema.safeParse({ ...full, summary: '   ' }).success).toBe(false);
    expect(
      schema.safeParse({ ...full, review_focus: [{ file: 'src/auth/login.ts', line: 0, reason: 'r' }] })
        .success,
    ).toBe(false);
  });

  it('stores the new brief in place of the old one and returns it, with usage, model and documents', async () => {
    const old = storedBrief();
    const t = build({ stored: old });

    const { brief } = await t.service.generate('ws-1', PULL.id, 'corr-1');

    expect(brief).not.toBeNull();
    expect(brief!.summary).toBe(ANSWER.summary);
    expect(brief!.summary).not.toBe(old.summary);
    expect(brief!.stale).toBe(false);
    expect(brief!.head_sha).toBe(PULL.headSha);
    expect(brief!.provider).toBe(MODEL.provider);
    expect(brief!.model).toBe(MODEL.model);
    expect(brief!.tokens_in).toBe(100);
    expect(brief!.tokens_out).toBe(50);
    expect(brief!.cost_usd).toBe(0.001);
    expect(brief!.documents_read).toEqual(['specs/auth.md', 'docs/limits.md']);

    expect(t.store.upserts).toHaveLength(1);
    const { stale: _stale, ...persisted } = brief!;
    expect(t.store.rows.get(PULL.id)).toEqual(persisted);
  });

  it('keeps a null cost and the adapter attempts when the model has no price', async () => {
    const provider = stubProvider(async <T>(req: StructuredRequest<T>) => ({
      data: req.schema.parse(ANSWER),
      model: req.model,
      tokensIn: 7,
      tokensOut: 3,
      costUsd: null,
      raw: '',
      attempts: 2,
    }));
    const t = build({ provider });

    const { brief } = await t.service.generate('ws-1', PULL.id, 'corr-1');

    expect(brief!.cost_usd).toBeNull();
    expect(brief!.tokens_in).toBe(7);
    expect(brief!.tokens_out).toBe(3);
    const [generated] = byEvent(t.lines, 'brief.generated');
    expect(generated!.obj).toMatchObject({ attempts: 2, tokensIn: 7, tokensOut: 3 });
  });
});

describe('BriefService.generate — the input', () => {
  it('sends the five facts and no patch text in any message', async () => {
    const t = build();

    await t.service.generate('ws-1', PULL.id, 'corr-1');

    const [req] = structuredCalls(t.mock);
    const user = userOf(req!);
    expect(user).toContain('src/auth/login.ts');
    expect(user).toContain('10-14,42-44');
    expect(user).toContain('src/auth/login.test.ts');
    expect(user).toContain('TITLE-MARKER');
    expect(user).toContain('BODY-MARKER');
    expect(user).toContain('INTENT-SENTENCE-MARKER');
    expect(user).toContain('BLAST-SUMMARY-MARKER');
    expect(user).toContain('src/api/session.ts');
    expect(user).toContain('DOC-ONE-MARKER');

    const everything = inputOf(req!);
    for (const marker of [
      'ADDED-LINE-MARKER',
      'CONTEXT-LINE-MARKER',
      'REMOVED-LINE-MARKER',
      'HEADER-TAIL-MARKER',
    ]) {
      expect(everything).not.toContain(marker);
    }
    for (const file of FILES) expect(t.roles.classify).toHaveBeenCalledWith(file.path);
  });

  it('keeps the system message to the template, with no text of the pull request', async () => {
    const t = build();

    await t.service.generate('ws-1', PULL.id, 'corr-1');

    const [req] = structuredCalls(t.mock);
    expect(req!.messages[0]).toEqual({ role: 'system', content: system });
    for (const marker of MARKERS) expect(req!.messages[0]!.content).not.toContain(marker);
  });

  it('leaves out the intent and returns it as null when none is stored', async () => {
    const t = build({ intent: null });

    const { brief } = await t.service.generate('ws-1', PULL.id, 'corr-1');

    expect(brief!.intent).toBeNull();
    expect(brief!.summary).toBe(ANSWER.summary);
    expect(userOf(structuredCalls(t.mock)[0]!)).not.toContain('## Intent');
    const [assembled] = byEvent(t.lines, 'prompt.assembled');
    expect(sectionNames(assembled!)).not.toContain('intent');
  });

  it('leaves out the blast radius and returns it as null when no symbol changed', async () => {
    const t = build({ blast: { changed_symbols: [], downstream: [], summary: '' } });

    const { brief } = await t.service.generate('ws-1', PULL.id, 'corr-1');

    expect(brief!.blast).toBeNull();
    expect(userOf(structuredCalls(t.mock)[0]!)).not.toContain('## Blast radius');
    const [assembled] = byEvent(t.lines, 'prompt.assembled');
    expect(sectionNames(assembled!)).not.toContain('blast_radius');
  });

  it('returns the stored intent and blast radius the generation read, and nothing more', async () => {
    const t = build();

    const { brief } = await t.service.generate('ws-1', PULL.id, 'corr-1');

    expect(brief!.intent).toEqual({
      intent: INTENT_RECORD.intent,
      in_scope: INTENT_RECORD.in_scope,
      out_of_scope: INTENT_RECORD.out_of_scope,
    });
    expect(brief!.blast).toEqual({
      changed_symbols: BLAST.changed_symbols,
      downstream: BLAST.downstream,
      summary: BLAST.summary,
    });
  });

  it('keeps the input inside the budget and still checks the answer against every file of the PR', async () => {
    const files: BriefPullFile[] = Array.from({ length: 600 }, (_, i) => ({
      path: `src/generated/module-${String(i).padStart(4, '0')}/component-${String(i).padStart(4, '0')}.ts`,
      additions: i,
      deletions: 0,
      patch: '@@ -1 +1 @@\n+x',
    }));
    const dropped = files[0]!.path;
    const answer: PrBriefAnswer = {
      summary: 'A wide change.',
      risks: [
        { kind: 'size', title: 'Wide', explanation: 'e', severity: 'low', file_refs: [dropped] },
      ],
      review_focus: [{ file: dropped, line: 1, reason: 'start here' }],
    };
    const t = build({ files, documents: [], answer });

    const { brief } = await t.service.generate('ws-1', PULL.id, 'corr-1');

    const [req] = structuredCalls(t.mock);
    expect(inputOf(req!)).not.toContain(dropped);
    const [generated] = byEvent(t.lines, 'brief.generated');
    const inputTokens = generated!.obj.inputTokens as number;
    expect(inputTokens).toBeLessThanOrEqual(BRIEF_INPUT_BUDGET_TOKENS);
    expect(inputTokens).toBe(count(req!.messages[0]!.content) + count(userOf(req!)));
    expect(brief!.risks.risks).toHaveLength(1);
    expect(brief!.review_focus).toEqual([{ file: dropped, line: 1, reason: 'start here' }]);
  });

  it('lists as read only the documents whose text was part of the input', async () => {
    const prose = (chars: number): string => 'lorem ipsum dolor sit amet '.repeat(chars / 27 + 1).slice(0, chars);
    const documents = [
      { path: 'docs/a.md', text: `DOC-A-MARKER ${prose(200)}` },
      { path: 'docs/b.md', text: prose(60_000) },
      { path: 'docs/c.md', text: `DOC-C-MARKER ${prose(200)}` },
    ];
    const t = build({ documents });

    const { brief } = await t.service.generate('ws-1', PULL.id, 'corr-1');

    const user = userOf(structuredCalls(t.mock)[0]!);
    expect(user).toContain('DOC-A-MARKER');
    expect(user).not.toContain('DOC-C-MARKER');
    expect(brief!.documents_read).toEqual(['docs/a.md', 'docs/b.md']);
    const [generated] = byEvent(t.lines, 'brief.generated');
    expect(generated!.obj.inputTokens as number).toBeLessThanOrEqual(BRIEF_INPUT_BUDGET_TOKENS);
  });
});

describe('BriefService.generate — the answer', () => {
  it('keeps only what names a file of the PR or its blast map, and a line of a changed hunk', async () => {
    const t = build({ answer: MIXED });

    const { brief } = await t.service.generate('ws-1', PULL.id, 'corr-1');

    expect(brief!.summary).toBe('Mixed answer.');
    expect(brief!.risks.risks).toEqual([
      {
        kind: 'security',
        title: 'Kept',
        explanation: 'e',
        severity: 'high',
        file_refs: ['src/auth/login.ts', 'src/api/session.ts'],
      },
    ]);
    expect(brief!.review_focus).toEqual([
      { file: 'src/auth/login.ts', line: 42, reason: 'second hunk' },
      { file: 'src/auth/login.test.ts', line: 3, reason: 'tests' },
    ]);
    expect(JSON.stringify(brief)).not.toContain('ghost');
    expect(JSON.stringify(t.store.rows.get(PULL.id))).not.toContain('ghost');

    const [generated] = byEvent(t.lines, 'brief.generated');
    expect(generated!.obj).toMatchObject({
      risksKept: 1,
      risksDiscarded: 3,
      focusKept: 2,
      focusDiscarded: 4,
    });
  });
});

describe('BriefService.generate — log lines', () => {
  it('writes one text-free prompt.assembled line and one brief.generated line with every field', async () => {
    const t = build();

    await t.service.generate('ws-1', PULL.id, 'corr-1');

    expect(t.lines).toHaveLength(2);
    const assembled = byEvent(t.lines, 'prompt.assembled');
    expect(assembled).toHaveLength(1);
    expect(assembled[0]!.obj).toMatchObject({
      purpose: 'brief',
      correlationId: 'corr-1',
      prId: PULL.id,
      provider: MODEL.provider,
      model: MODEL.model,
    });
    expect(sectionNames(assembled[0]!)).toEqual([
      'system',
      'diff_stats',
      'intent',
      'blast_radius',
      'pr_text',
      'documents',
    ]);
    for (const section of assembled[0]!.obj.sections as { chars: number }[]) {
      expect(section.chars).toBeGreaterThan(0);
    }

    const generated = byEvent(t.lines, 'brief.generated');
    expect(generated).toHaveLength(1);
    const [req] = structuredCalls(t.mock);
    expect(generated[0]!.obj).toEqual({
      event: 'brief.generated',
      prId: PULL.id,
      provider: MODEL.provider,
      model: MODEL.model,
      inputTokens: count(req!.messages[0]!.content) + count(userOf(req!)),
      budget: BRIEF_INPUT_BUDGET_TOKENS,
      attempts: 1,
      tokensIn: 100,
      tokensOut: 50,
      risksKept: 1,
      risksDiscarded: 0,
      focusKept: 1,
      focusDiscarded: 0,
      durationMs: expect.any(Number),
    });
    expect(generated[0]!.msg).toBe('brief generated');

    const logged = JSON.stringify(t.lines);
    for (const marker of MARKERS) expect(logged).not.toContain(marker);
    expect(logged).not.toContain('src/auth/login.ts');
    expect(logged).not.toContain('specs/auth.md');
  });

  it('writes the brief.generated line when the prompt log is off', async () => {
    const t = build({ promptMode: 'off' });

    await t.service.generate('ws-1', PULL.id, 'corr-1');

    expect(byEvent(t.lines, 'prompt.assembled')).toHaveLength(0);
    expect(byEvent(t.lines, 'brief.generated')).toHaveLength(1);
    expect(t.lines).toHaveLength(1);
  });
});

describe('BriefService.generate — failures', () => {
  it('turns a provider error into a 502 and leaves the stored brief as it was', async () => {
    const old = storedBrief();
    const provider = stubProvider(async () => {
      throw new Error('upstream exploded');
    });
    const t = build({ provider, stored: old });

    await expect(t.service.generate('ws-1', PULL.id, 'corr-1')).rejects.toMatchObject({
      statusCode: 502,
      code: 'external_service_error',
      message: 'upstream exploded',
    });

    expect(t.store.upserts).toHaveLength(0);
    expect(t.store.rows.get(PULL.id)).toBe(old);
    expect(byEvent(t.lines, 'brief.generated')).toHaveLength(0);
    expect(byEvent(t.lines, 'prompt.assembled')).toHaveLength(1);
  });

  it('turns an answer that fails the schema into a 502 and leaves the stored brief as it was', async () => {
    const old = storedBrief();
    const t = build({ answer: { summary: '', risks: [], review_focus: [] }, stored: old });

    await expect(t.service.generate('ws-1', PULL.id, 'corr-1')).rejects.toMatchObject({
      statusCode: 502,
      code: 'external_service_error',
    });

    expect(t.store.upserts).toHaveLength(0);
    expect(t.store.rows.get(PULL.id)).toBe(old);
    expect(byEvent(t.lines, 'brief.generated')).toHaveLength(0);
  });

  it('rethrows an application error of the provider unchanged', async () => {
    const failure = new AppError('rate_limited', 'slow down', 429);
    const t = build({
      provider: stubProvider(async () => {
        throw failure;
      }),
    });

    await expect(t.service.generate('ws-1', PULL.id, 'corr-1')).rejects.toBe(failure);
    expect(t.store.upserts).toHaveLength(0);
  });

  it('answers 502 once the 60 000 ms deadline has passed', async () => {
    vi.useFakeTimers();
    let reachedCall!: () => void;
    const reached = new Promise<void>((resolve) => {
      reachedCall = resolve;
    });
    const provider = stubProvider(() => {
      reachedCall();
      return new Promise<never>(() => {});
    });
    const old = storedBrief();
    const t = build({ provider, stored: old });

    let settled = false;
    const outcome = t.service.generate('ws-1', PULL.id, 'corr-1').then(
      () => null,
      (err: unknown) => {
        settled = true;
        return err;
      },
    );
    await reached;

    await vi.advanceTimersByTimeAsync(BRIEF_MODEL_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toMatchObject({ statusCode: 502, code: 'external_service_error' });
    expect(t.store.upserts).toHaveLength(0);
    expect(t.store.rows.get(PULL.id)).toBe(old);
  });

  it('answers 400 brief_model_unavailable before anything else is read when no key is configured', async () => {
    const t = build({
      llm: async () => {
        throw new ConfigError('no key');
      },
    });

    await expect(t.service.generate('ws-1', PULL.id, 'corr-1')).rejects.toMatchObject({
      code: 'brief_model_unavailable',
      statusCode: 400,
      message: expect.stringContaining('Settings'),
    });

    expect(t.mock.calls).toHaveLength(0);
    expect(t.pulls.listFiles).not.toHaveBeenCalled();
    expect(t.intent.getForPull).not.toHaveBeenCalled();
    expect(t.blast.forPull).not.toHaveBeenCalled();
    expect(t.context.resolveForWorkspace).not.toHaveBeenCalled();
    expect(t.store.upserts).toHaveLength(0);
    expect(t.lines).toHaveLength(0);
  });
});

describe('BriefService — a pull request outside the workspace', () => {
  it('answers not found from both methods and calls nothing else', async () => {
    const t = build({ pull: undefined, stored: storedBrief() });

    await expect(t.service.getForPull('ws-1', PULL.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(t.service.generate('ws-1', PULL.id, 'corr-1')).rejects.toBeInstanceOf(NotFoundError);

    expect(t.llm).not.toHaveBeenCalled();
    expect(t.mock.calls).toHaveLength(0);
    expect(t.pulls.listFiles).not.toHaveBeenCalled();
    expect(t.store.upserts).toHaveLength(0);
  });
});

describe('BriefService.getForPull', () => {
  it('answers a null brief when none is stored', async () => {
    const t = build();

    expect(await t.service.getForPull('ws-1', PULL.id)).toEqual({ brief: null });
  });

  it('returns the stored brief as stale only when its head commit differs from the stored one', async () => {
    const older = build({ stored: storedBrief({ head_sha: 'sha-old' }) });
    const current = build({ stored: storedBrief({ head_sha: PULL.headSha }) });

    const stale = await older.service.getForPull('ws-1', PULL.id);
    const fresh = await current.service.getForPull('ws-1', PULL.id);

    expect(stale.brief!.stale).toBe(true);
    expect(stale.brief!.summary).toBe('Older summary.');
    expect(fresh.brief!.stale).toBe(false);
  });

  it('calls no model and no other port, and writes no log line', async () => {
    const t = build({ stored: storedBrief() });

    await t.service.getForPull('ws-1', PULL.id);

    expect(t.lines).toHaveLength(0);
    expect(t.llm).not.toHaveBeenCalled();
    expect(t.mock.calls).toHaveLength(0);
    expect(t.pulls.listFiles).not.toHaveBeenCalled();
    expect(t.intent.getForPull).not.toHaveBeenCalled();
    expect(t.blast.forPull).not.toHaveBeenCalled();
    expect(t.context.resolveForWorkspace).not.toHaveBeenCalled();
    expect(t.roles.classify).not.toHaveBeenCalled();
    expect(t.store.upserts).toHaveLength(0);
  });
});
