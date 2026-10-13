import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EvalCase,
  EvalCaseCreateInput,
  EvalCaseDraft,
  EvalCaseDraftResponse,
  EvalCaseTryInput,
  EvalCaseTryResult,
  EvalRun,
  EvalRunDetail,
  EvalRunCompare,
  EvalDashboard,
  EvalSkillRunStartInput,
  EvalSkillCaseTryInput,
  EvalSkillCompareSide,
  EvalSkillRunCompare,
} from '@devdigest/shared';

const root = resolve(__dirname, '../..');
const read = (pkg: 'server' | 'client', file: string) =>
  readFileSync(resolve(root, pkg, 'src/vendor/shared/contracts', file), 'utf8');

const run = {
  id: 'r1',
  agent_id: 'a1',
  agent_version: 2,
  skill_id: null,
  skill_version: null,
  status: 'done',
  started_at: '2026-10-12T10:00:00.000Z',
  duration_ms: 4000,
  recall: 1,
  precision: 0.5,
  citation_accuracy: null,
  cases_total: 2,
  cases_passed: 1,
  cases_failed: 1,
  cases_errored: 0,
  findings_total: 3,
  findings_grounded: 2,
  cost_usd: null,
  provider: 'openrouter',
  model: 'm',
  skills: [],
  case_ids: ['c1', 'c2'],
  error: null,
};

const expected = {
  file: 'src/a.ts',
  start_line: 3,
  end_line: 4,
  severity: 'WARNING',
  category: 'security',
  title: 'T',
};

describe('eval contracts: both copies', () => {
  it('contracts/eval.ts is byte-identical in server and client', () => {
    expect(read('client', 'eval.ts')).toBe(read('server', 'eval.ts'));
  });

  it.each(['server', 'client'] as const)('%s copy of eval-ci.ts no longer declares EvalCaseInput', (pkg) => {
    expect(read(pkg, 'eval-ci.ts')).not.toContain('EvalCaseInput');
  });

  it.each(['server', 'client'] as const)('%s copy no longer declares the reserved shapes', (pkg) => {
    for (const file of ['knowledge.ts', 'eval-ci.ts']) {
      const text = read(pkg, file);
      for (const name of ['EvalRunRecord', 'EvalRunResult', 'EvalPerTrace']) {
        expect(text).not.toContain(name);
      }
    }
  });
});

describe('eval contracts: shapes', () => {
  it('parses a run, with and without results', () => {
    expect(EvalRun.parse(run).citation_accuracy).toBeNull();
    const detail = EvalRunDetail.parse({
      ...run,
      results: [
        {
          case_id: 'c1',
          case_name: 'must-find-t',
          case_revision: 1,
          expectation_type: 'must_find',
          status: 'pass',
          matched: 1,
          findings: [expected],
          error: null,
        },
      ],
    });
    expect(detail.results).toHaveLength(1);
  });

  it('rejects a metric outside 0..1 and an unknown status', () => {
    expect(() => EvalRun.parse({ ...run, recall: 1.2 })).toThrow();
    expect(() => EvalRun.parse({ ...run, status: 'queued' })).toThrow();
  });

  it('parses a case with a last result', () => {
    const c = EvalCase.parse({
      id: 'c1',
      owner_kind: 'agent',
      owner_id: 'a1',
      name: 'must-find-t',
      expectation_type: 'must_not_flag',
      expected_output: expected,
      input_diff: 'diff',
      input_files: ['src/a.ts'],
      input_meta: { pr_number: 1, pr_title: 't', pr_author: 'u', pr_body: null },
      source_finding_id: null,
      notes: null,
      revision: 1,
      created_at: '2026-10-12T10:00:00.000Z',
      last_result: { run_id: 'r1', status: 'error', matched: 0, error: 'boom' },
    });
    expect(c.last_result?.status).toBe('error');
  });

  it('parses a hand-made case with no pull request number and author', () => {
    const c = EvalCase.parse({
      id: 'c2',
      owner_kind: 'agent',
      owner_id: 'a1',
      name: 'hand',
      expectation_type: 'must_find',
      expected_output: expected,
      input_diff: 'diff',
      input_files: [],
      input_meta: { pr_number: null, pr_title: 't', pr_author: null, pr_body: null },
      source_finding_id: null,
      notes: null,
      revision: 3,
      created_at: '2026-10-12T10:00:00.000Z',
      last_result: null,
    });
    expect(c.input_meta.pr_number).toBeNull();
    expect(c.revision).toBe(3);
  });

  it('fills the optional expectation values of a create payload with empty strings', () => {
    const parsed = EvalCaseCreateInput.parse({
      name: ' n ',
      expectation_type: 'must_find',
      input_diff: 'diff',
      input_meta: { pr_body: null },
      expected_output: { file: 'src/a.ts', start_line: 1, end_line: 1 },
    });
    expect(parsed.name).toBe('n');
    expect(parsed.input_meta.pr_title).toBe('');
    expect(parsed.expected_output).toMatchObject({ title: '', severity: '', category: '' });
  });

  it('rejects a blank name and an end line below the start line', () => {
    const body = {
      name: 'n',
      expectation_type: 'must_find',
      input_diff: 'diff',
      input_meta: { pr_body: null },
      expected_output: { file: 'src/a.ts', start_line: 3, end_line: 3 },
    };
    expect(() => EvalCaseCreateInput.parse({ ...body, name: '   ' })).toThrow();
    expect(() =>
      EvalCaseCreateInput.parse({ ...body, expected_output: { file: 'src/a.ts', start_line: 3, end_line: 2 } }),
    ).toThrow();
  });

  it('parses a draft response, with a draft and with an existing case', () => {
    const draft = {
      expectation_type: 'must_find',
      name: 'must-find-t',
      input_diff: 'diff',
      input_meta: { pr_number: 7, pr_title: 't', pr_author: 'u', pr_body: null },
      expected_output: expected,
      problem: null,
    };
    const agent = { id: 'a1', name: 'A' };
    expect(EvalCaseDraftResponse.parse({ agent, case: null, draft }).draft?.problem).toBeNull();
    expect(EvalCaseDraft.parse({ ...draft, problem: 'lines_outside_diff' }).problem).toBe('lines_outside_diff');
    expect(() => EvalCaseDraft.parse({ ...draft, problem: 'other' })).toThrow();
    expect(EvalCaseDraftResponse.parse({ agent, case: null, draft: null }).case).toBeNull();
  });

  const tryBody = {
    expectation_type: 'must_find',
    input_diff: 'diff',
    input_meta: { pr_number: null, pr_title: 't', pr_author: null, pr_body: null },
    expected_output: { file: 'src/a.ts', start_line: 3, end_line: 4 },
  };

  it('parses a try body and drops the keys it does not use', () => {
    const parsed = EvalCaseTryInput.parse({
      ...tryBody,
      expected_output: { ...tryBody.expected_output, severity: 'WARNING', title: 'T' },
    });
    expect(parsed.expected_output).toEqual({ file: 'src/a.ts', start_line: 3, end_line: 4 });
  });

  it('rejects a blank diff and an end line below the start line in a try body', () => {
    expect(() => EvalCaseTryInput.parse({ ...tryBody, input_diff: '  ' })).toThrow();
    expect(() =>
      EvalCaseTryInput.parse({ ...tryBody, expected_output: { file: 'src/a.ts', start_line: 3, end_line: 2 } }),
    ).toThrow();
  });

  it('parses a try result for pass and for error', () => {
    const base = { status: 'pass', matched: 1, findings: [expected], error: null, duration_ms: 10, cost_usd: 0.001 };
    expect(EvalCaseTryResult.parse(base).status).toBe('pass');
    expect(EvalCaseTryResult.parse({ ...base, status: 'error', matched: 0, findings: [], error: 'x', cost_usd: null }).cost_usd).toBeNull();
    expect(() => EvalCaseTryResult.parse({ ...base, error: 'x'.repeat(501) })).toThrow();
  });

  it('parses a comparison and a dashboard', () => {
    const side = {
      run_id: 'r1',
      agent_version: 1,
      system_prompt: 'p',
      provider: 'openrouter',
      model: 'm',
      skills: ['s'],
      started_at: '2026-10-12T10:00:00.000Z',
      recall: 0.5,
      precision: null,
      citation_accuracy: 1,
      cost_usd: 0.01,
      cases_total: 2,
      cases_passed: 1,
    };
    expect(() =>
      EvalRunCompare.parse({ base: side, head: side, cases_only_in_base: [], cases_only_in_head: ['x'], cases_edited: [] }),
    ).not.toThrow();
    expect(() =>
      EvalDashboard.parse({
        agents: [{ agent_id: 'a1', name: 'A', model: 'm', latest_run: null, case_count: 0, run_in_progress: false, trend: [] }],
        recent_runs: [{ ...run, agent_name: 'A' }],
      }),
    ).not.toThrow();
  });
});

describe('eval contracts: dashboard rows', () => {
  const agent = { agent_id: 'a1', name: 'A', model: 'm', latest_run: null };
  const point = { recall: 0.5, precision: null, citation_accuracy: 1 };

  it('parses case_count, run_in_progress and trend', () => {
    const parsed = EvalDashboard.parse({
      agents: [{ ...agent, case_count: 3, run_in_progress: true, trend: [point] }],
      recent_runs: [],
    });
    expect(parsed.agents[0]).toMatchObject({ case_count: 3, run_in_progress: true, trend: [point] });
  });

  it('refuses 21 trend entries', () => {
    expect(() =>
      EvalDashboard.parse({
        agents: [
          { ...agent, case_count: 0, run_in_progress: false, trend: Array.from({ length: 21 }, () => point) },
        ],
        recent_runs: [],
      }),
    ).toThrow();
  });
});

describe('eval contracts: skill evals', () => {
  const hostId = '3f1c2b8e-6a4d-4c1e-9b7a-2d5e8f0a1b3c';
  const tryBody = {
    expectation_type: 'must_find',
    input_diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n+x',
    input_meta: { pr_number: 1, pr_title: 't', pr_author: 'a', pr_body: 'b' },
    expected_output: { file: 'a.ts', start_line: 1, end_line: 1 },
  };
  const side = {
    run_id: 'r1',
    skill_version: 2,
    skill_body: 'body',
    agent_id: 'a1',
    agent_version: 3,
    provider: 'openrouter',
    model: 'm',
    started_at: '2026-10-13T10:00:00.000Z',
    recall: 0.5,
    precision: null,
    citation_accuracy: 1,
    cost_usd: null,
    cases_total: 2,
    cases_passed: 1,
  };

  it('parses a run that carries a skill and one that carries none', () => {
    expect(EvalRun.parse({ ...run, skill_id: 'sk1', skill_version: 4 }).skill_version).toBe(4);
    const plain = EvalRun.parse(run);
    expect(plain.skill_id).toBeNull();
    expect(plain.skill_version).toBeNull();
  });

  it('parses one valid value of each new schema', () => {
    expect(EvalSkillRunStartInput.parse({ host_agent_id: hostId }).host_agent_id).toBe(hostId);
    expect(EvalSkillCaseTryInput.parse({ ...tryBody, host_agent_id: hostId }).host_agent_id).toBe(hostId);
    expect(EvalSkillCompareSide.parse(side).skill_body).toBe('body');
    expect(
      EvalSkillRunCompare.parse({ base: side, head: side, cases_only_in_base: [], cases_only_in_head: ['x'], cases_edited: [] })
        .cases_only_in_head,
    ).toEqual(['x']);
  });

  it('refuses a host agent id that is not a uuid', () => {
    expect(() => EvalSkillRunStartInput.parse({ host_agent_id: 'not-a-uuid' })).toThrow();
    expect(() => EvalSkillCaseTryInput.parse({ ...tryBody, host_agent_id: 'not-a-uuid' })).toThrow();
    expect(() => EvalSkillRunStartInput.parse({})).toThrow();
  });
});
