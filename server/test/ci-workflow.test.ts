import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { AgentManifest, CiExportInput } from '@devdigest/shared';
import { renderWorkflow } from '../src/modules/ci/workflow.js';
import {
  agentManifestPath,
  buildAgentManifest,
  renderAgentManifestYaml,
} from '../src/modules/ci/manifest.js';
import { findSecretFile, memoryJsonl, slugify, toCiFile, uniqueSkillSlugs } from '../src/modules/ci/helpers.js';
import type { CiAgentRecord } from '../src/modules/ci/types.js';

type Step = { uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Workflow = {
  on: Record<string, { types: string[] }>;
  permissions: Record<string, string>;
  jobs: { review: { steps: Step[] } };
};

const render = (triggers: string[] = ['opened', 'synchronize'], postAs = 'github_review') =>
  parse(renderWorkflow({ triggers, postAs })) as Workflow;

describe('generated workflow', () => {
  it('triggers only on pull_request with the selected types, never pull_request_target (AC-26)', () => {
    const wf = render(['reopened', 'opened']);
    expect(Object.keys(wf.on)).toEqual(['pull_request']);
    expect(wf.on.pull_request?.types).toEqual(['opened', 'reopened']);
    expect(renderWorkflow({ triggers: ['opened'], postAs: 'none' })).not.toContain('pull_request_target');
  });

  it('declares exactly contents: read and pull-requests: write (AC-27)', () => {
    expect(render().permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
  });

  it('pins every uses: reference to a 40-hex commit SHA (AC-28)', () => {
    const uses = render().jobs.review.steps.flatMap((s) => (s.uses ? [s.uses] : []));
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('checks out the base commit with credentials not persisted (AC-29)', () => {
    const checkout = render().jobs.review.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.ref).toBe('${{ github.event.pull_request.base.sha }}');
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });

  it('runs the bundled runner with the secret, job token, PR number and post mode (AC-30)', () => {
    const step = render(['opened'], 'pr_comment').jobs.review.steps.find((s) => s.run?.includes('index.js'));
    expect(step?.run).toBe('node .devdigest/runner/index.js');
    expect(step?.env).toEqual({
      OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
      GITHUB_TOKEN: '${{ github.token }}',
      PR_NUMBER: '${{ github.event.pull_request.number }}',
      DEVDIGEST_POST_AS: 'pr_comment',
    });
  });

  it('puts no pull request text expression inside any run: script (AC-31)', () => {
    const runs = render().jobs.review.steps.flatMap((s) => (s.run ? [s.run] : []));
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) expect(r).not.toMatch(/\$\{\{[^}]*(title|body|head|comment)/i);
    for (const r of runs) expect(r).not.toContain('${{');
  });

  it('uploads devdigest-result.json always and ignores a missing file (AC-32)', () => {
    const upload = render().jobs.review.steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.if).toBe('always()');
    expect(upload?.with).toMatchObject({
      name: 'devdigest-result',
      path: 'devdigest-result.json',
      'if-no-files-found': 'ignore',
    });
  });

  it('refuses an empty trigger set and an unknown post mode', () => {
    expect(() => renderWorkflow({ triggers: [], postAs: 'none' })).toThrow();
    expect(() => renderWorkflow({ triggers: ['opened'], postAs: 'x; rm -rf /' })).toThrow();
  });
});

describe('agent manifest', () => {
  const agent: CiAgentRecord = {
    id: 'a1',
    name: 'Security Reviewer',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: 'Review: for secrets.\nSecond line "quoted" # not a comment',
    strategy: 'map-reduce',
    ciFailOn: 'warning',
    version: 7,
  };

  it('is parsed back by AgentManifest to the agent it was written from (AC-14)', () => {
    const yaml = renderAgentManifestYaml(buildAgentManifest(agent, ['sql-injection', 'auth']));
    const back = AgentManifest.parse(parse(yaml));
    expect(back).toEqual({
      name: 'Security Reviewer',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      system_prompt: agent.systemPrompt,
      skills: ['sql-injection', 'auth'],
      strategy: 'map-reduce',
      ci_fail_on: 'warning',
      version: 7,
    });
  });

  it('writes the manifest under .devdigest/agents/<slug>.yaml', () => {
    expect(agentManifestPath('Security Reviewer!')).toBe('.devdigest/agents/security-reviewer.yaml');
    expect(agentManifestPath('!!!')).toBe('.devdigest/agents/agent.yaml');
  });
});

describe('ci helpers', () => {
  it('memoryJsonl writes one kind/scope/content object per line, empty for none (AC-24)', () => {
    expect(memoryJsonl([])).toBe('');
    const out = memoryJsonl([
      { kind: 'convention', scope: 'global', content: 'use pnpm\nnot npm' },
      { kind: 'fact', scope: 'global', content: 'x' },
    ]);
    const lines = out.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ kind: 'convention', scope: 'global', content: 'use pnpm\nnot npm' });
    expect(Object.keys(JSON.parse(lines[1]!))).toEqual(['kind', 'scope', 'content']);
  });

  it('findSecretFile names the file holding a secret value and ignores short values (AC-20)', () => {
    const files = [
      toCiFile('a.md', 'clean', false),
      toCiFile('b.md', 'token=sk-or-v1-SENTINELSECRET', false),
    ];
    expect(findSecretFile(files, ['sk-or-v1-SENTINELSECRET'])).toBe('b.md');
    expect(findSecretFile(files, ['clean'])).toBeNull();
    expect(findSecretFile(files, [])).toBeNull();
  });

  it('slugify and uniqueSkillSlugs produce stable kebab-case, disambiguating collisions', () => {
    expect(slugify('  My Skill: v2!! ')).toBe('my-skill-v2');
    expect(uniqueSkillSlugs([{ name: 'A b' }, { name: 'a-b' }, { name: 'A  B' }, { name: '???' }])).toEqual([
      'a-b',
      'a-b-2',
      'a-b-3',
      'skill',
    ]);
  });
});

describe('CiExportInput repo (AC-25 at the contract)', () => {
  it('accepts owner/name and rejects anything else', () => {
    const ok = CiExportInput.safeParse({ repo: 'vklyovsa/devdigest-demo' });
    expect(ok.success).toBe(true);
    for (const repo of ['acme', '../x', 'a/..', 'a/b/c', '', ' a/b']) {
      expect(CiExportInput.safeParse({ repo }).success, repo).toBe(false);
    }
  });
});
