import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LLMProvider, StructuredResult, Review } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import { runCi, type RunCiDeps } from './run.js';
import type { FetchLike } from './github.js';

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -9,3 +9,4 @@
 host: 'localhost',
+apiKey: 'sk_live_abcdef123456',
 port: 3000,
 timeout: 30,
`;

const MANIFEST_YAML = `
name: "Security Reviewer"
provider: "openrouter"
model: "deepseek/deepseek-v4-flash"
system_prompt: "Review this PR for security issues."
skills: []
strategy: "single-pass"
ci_fail_on: "critical"
`;

const OPENROUTER_SENTINEL = 'sk-or-v1-SENTINEL0123456789abcdef';
const GITHUB_SENTINEL = 'ghs_SENTINEL0123456789abcdef';

function reviewWith(text: string): Review {
  return {
    verdict: 'approve',
    summary: text,
    score: 50,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: text,
        file: 'src/config.ts',
        start_line: 10,
        end_line: 10,
        rationale: text,
        confidence: 0.9,
        kind: 'finding',
      },
    ],
  };
}

function makeLlm(behaviour: Review | Error): LLMProvider {
  return {
    id: 'openrouter',
    async listModels() {
      return [];
    },
    async complete() {
      throw new Error('complete() not used');
    },
    async completeStructured<T>(): Promise<StructuredResult<T>> {
      if (behaviour instanceof Error) throw behaviour;
      return {
        data: behaviour as unknown as T,
        model: 'deepseek/deepseek-v4-flash',
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0.001,
        raw: JSON.stringify(behaviour),
        attempts: 1,
      };
    },
    async embed() {
      return [];
    },
  };
}

function makeFetchRecorder(): { fetchImpl: FetchLike; bodies: string[] } {
  const bodies: string[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    if (init?.body) bodies.push(String(init.body));
    return new Response('{}', { status: 200 });
  }) as unknown as FetchLike;
  return { fetchImpl, bodies };
}

describe('runCi result artifact and secret hygiene (SPEC-12 AC-33, AC-34)', () => {
  let dir: string;
  let resultPath: string;
  let eventPath: string;

  function writeEvent(event: unknown): void {
    writeFileSync(eventPath, JSON.stringify(event));
  }

  function validEvent(): Record<string, unknown> {
    return {
      pull_request: {
        number: 42,
        title: 'Add feature X',
        body: 'body',
        head: { sha: 'd'.repeat(40), repo: { fork: false } },
      },
      repository: { id: 987654 },
    };
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-artifact-'));
    mkdirSync(path.join(dir, 'agents'), { recursive: true });
    mkdirSync(path.join(dir, 'skills'), { recursive: true });
    writeFileSync(path.join(dir, 'agents', 'security-reviewer.yaml'), MANIFEST_YAML);
    eventPath = path.join(dir, 'event.json');
    resultPath = path.join(dir, 'devdigest-result.json');
    writeEvent(validEvent());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function baseDeps(overrides: Partial<RunCiDeps> = {}): RunCiDeps {
    return {
      devdigestDir: dir,
      env: {
        GITHUB_REPOSITORY: 'acme/widgets',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_TOKEN: GITHUB_SENTINEL,
        OPENROUTER_API_KEY: OPENROUTER_SENTINEL,
      },
      llm: makeLlm(reviewWith('plain finding')),
      postAs: 'github_review',
      resultPath,
      fetchImpl: makeFetchRecorder().fetchImpl,
      fetchDiff: async () => DIFF,
      ...overrides,
    };
  }

  describe('AC-33: artifact shape and event-sourced identity', () => {
    it('writes exactly the CiResultArtifact fields, with head_sha and repository_id taken from the event payload', async () => {
      const result = await runCi(baseDeps());

      expect(result.error).toBeUndefined();
      const onDisk = JSON.parse(readFileSync(resultPath, 'utf8')) as Record<string, unknown>;
      expect(Object.keys(onDisk).sort()).toEqual(Object.keys(CiResultArtifact.shape).sort());
      expect(onDisk.head_sha).toBe('d'.repeat(40));
      expect(onDisk.repository_id).toBe(987654);
      expect(Object.keys(result.artifact!).sort()).toEqual(Object.keys(CiResultArtifact.shape).sort());
    });

    it('IF the event carries a malformed head SHA THEN exits 1 with no artifact', async () => {
      const event = validEvent();
      (event.pull_request as { head: { sha: string } }).head.sha = 'not-a-sha';
      writeEvent(event);

      const result = await runCi(baseDeps());

      expect(result.exitCode).toBe(1);
      expect(result.artifact).toBeNull();
      expect(existsSync(resultPath)).toBe(false);
    });

    it('IF the event carries no repository.id THEN exits 1 with no artifact', async () => {
      const event = validEvent();
      delete event.repository;
      writeEvent(event);

      const result = await runCi(baseDeps());

      expect(result.exitCode).toBe(1);
      expect(result.artifact).toBeNull();
      expect(existsSync(resultPath)).toBe(false);
    });
  });

  describe('AC-34: neither token value reaches an output channel', () => {
    function expectNoSecret(haystack: string): void {
      expect(haystack).not.toContain(OPENROUTER_SENTINEL);
      expect(haystack).not.toContain(GITHUB_SENTINEL);
    }

    it('redacts both tokens echoed in model finding text from the posted review, comments, artifact file and result', async () => {
      const leaky = `leaked ${OPENROUTER_SENTINEL} and ${GITHUB_SENTINEL}`;
      const { fetchImpl, bodies } = makeFetchRecorder();

      const result = await runCi(baseDeps({ llm: makeLlm(reviewWith(leaky)), fetchImpl }));

      expect(result.error).toBeUndefined();
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toContain('***');
      expectNoSecret(bodies[0]!);
      expectNoSecret(readFileSync(resultPath, 'utf8'));
      expectNoSecret(JSON.stringify(result.posted));
      expectNoSecret(JSON.stringify(result.artifact));
    });

    it('redacts both tokens from the pr_comment body too', async () => {
      const leaky = `leaked ${OPENROUTER_SENTINEL} and ${GITHUB_SENTINEL}`;
      const { fetchImpl, bodies } = makeFetchRecorder();

      await runCi(baseDeps({ llm: makeLlm(reviewWith(leaky)), fetchImpl, postAs: 'pr_comment' }));

      expect(bodies).toHaveLength(1);
      expectNoSecret(bodies[0]!);
    });

    it('redacts both tokens from the error of a failing model call; nothing is posted or written', async () => {
      const { fetchImpl, bodies } = makeFetchRecorder();
      const llm = makeLlm(new Error(`401 for key ${OPENROUTER_SENTINEL} (gh ${GITHUB_SENTINEL})`));

      const result = await runCi(baseDeps({ llm, fetchImpl }));

      expect(result.exitCode).toBe(1);
      expect(result.error).toBeTruthy();
      expectNoSecret(result.error!);
      expect(bodies).toHaveLength(0);
      expect(existsSync(resultPath)).toBe(false);
    });

    it('redacts both tokens from the error of a failing diff fetch', async () => {
      const fetchDiff = async () => {
        throw new Error(`GitHub 403 for Bearer ${GITHUB_SENTINEL} / ${OPENROUTER_SENTINEL}`);
      };

      const result = await runCi(baseDeps({ fetchDiff }));

      expect(result.exitCode).toBe(1);
      expect(result.error).toBeTruthy();
      expectNoSecret(result.error!);
      expect(existsSync(resultPath)).toBe(false);
    });
  });
});
