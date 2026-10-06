import { describe, expect, it } from 'vitest';
import { MAX_RESULT_CHARS } from '../constants.js';
import type { AgentInfo } from '../ports.js';
import { FakeDevDigestApi, fakeAgent } from '../testing/fake-api.js';
import { listAgents } from './list-agents.js';

const apiWith = (agents: AgentInfo[]): FakeDevDigestApi => new FakeDevDigestApi({ agents });

describe('listAgents', () => {
  it('returns the five documented fields per agent and the total', async () => {
    const api = apiWith([fakeAgent({ id: 'a-1', name: 'Security Reviewer', model: 'm/x', enabled: false })]);

    const result = await listAgents(api);

    expect(result).toEqual({
      agents: [
        { id: 'a-1', name: 'Security Reviewer', enabled: false, model: 'm/x', description: 'Looks for vulnerabilities.' },
      ],
      total: 1,
    });
  });

  it('never returns prompt text or schemas, even if the port object carries them', async () => {
    const leaky = {
      ...fakeAgent(),
      systemPrompt: 'SECRET PROMPT',
      system_prompt: 'SECRET PROMPT',
      output_schema: { type: 'object' },
    } as AgentInfo;

    const result = await listAgents(apiWith([leaky]));

    expect(JSON.stringify(result)).not.toMatch(/SECRET PROMPT|output_schema|system_prompt|systemPrompt/);
    expect(Object.keys(result.agents[0] ?? {}).sort()).toEqual(['description', 'enabled', 'id', 'model', 'name']);
  });

  it('sorts by name ignoring case, then by id', async () => {
    const result = await listAgents(
      apiWith([
        fakeAgent({ id: 'a-3', name: 'zeta' }),
        fakeAgent({ id: 'a-2', name: 'Alpha' }),
        fakeAgent({ id: 'a-9', name: 'beta' }),
        fakeAgent({ id: 'a-1', name: 'beta' }),
      ]),
    );

    expect(result.agents.map((a) => [a.name, a.id])).toEqual([
      ['Alpha', 'a-2'],
      ['beta', 'a-1'],
      ['beta', 'a-9'],
      ['zeta', 'a-3'],
    ]);
  });

  it('keeps disabled agents, flagged', async () => {
    const result = await listAgents(apiWith([fakeAgent({ enabled: false })]));
    expect(result.agents[0]?.enabled).toBe(false);
  });

  it('clips the description and strips control characters from model-facing text', async () => {
    const result = await listAgents(
      apiWith([fakeAgent({ description: `Line one\n${'x'.repeat(500)}`, name: 'Na\u0000me' })]),
    );

    expect(result.agents[0]?.description).toHaveLength(160);
    expect(result.agents[0]?.description.startsWith('Line one xxx')).toBe(true);
    expect(result.agents[0]?.name).toBe('Name');
  });

  it('an empty list is an empty result, not an error', async () => {
    expect(await listAgents(apiWith([]))).toEqual({ agents: [], total: 0 });
  });

  it('lists 50 and says how many are left when there are more', async () => {
    const agents = Array.from({ length: 60 }, (_, i) =>
      fakeAgent({ id: `a-${String(i).padStart(2, '0')}`, name: `Agent ${String(i).padStart(2, '0')}` }),
    );

    const result = await listAgents(apiWith(agents));

    expect(result.agents).toHaveLength(50);
    expect(result.total).toBe(60);
    expect(result.truncated).toBe(true);
    expect(result.next).toContain('Showing 50 of 60 agents');
    expect(result.agents[49]?.name).toBe('Agent 49');
  });

  it('stays under the result ceiling at maximum field lengths', async () => {
    const agents = Array.from({ length: 50 }, (_, i) =>
      fakeAgent({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        name: `${'n'.repeat(200)}${i}`,
        model: 'm'.repeat(200),
        description: 'd'.repeat(500),
      }),
    );

    const result = await listAgents(apiWith(agents));

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.agents.length).toBeLessThan(50);
  });

  it('only reads the agent list', async () => {
    const api = apiWith([fakeAgent()]);
    await listAgents(api);
    expect(api.calls.map((c) => c.method)).toEqual(['listAgents']);
  });
});
