import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const create = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

import { OpenRouterProvider } from '../src/llm/openrouter.js';

const Schema = z.object({ ok: z.boolean() });

const reply = (content: string, usage: Record<string, unknown>) => ({
  choices: [{ message: { content } }],
  usage,
});

const call = (provider: OpenRouterProvider) =>
  provider.completeStructured({
    model: 'm',
    schema: Schema,
    schemaName: 'Probe',
    messages: [{ role: 'user', content: 'hi' }],
  });

describe('OpenRouterProvider cost parts', () => {
  beforeEach(() => create.mockReset());

  it('bills the attempt that reported a cost and estimates the one that did not', async () => {
    create
      .mockResolvedValueOnce(reply('not json', { prompt_tokens: 10, completion_tokens: 5, cost: 0.002 }))
      .mockResolvedValueOnce(reply('{"ok":true}', { prompt_tokens: 20, completion_tokens: 7 }));
    const estimateCost = vi.fn().mockReturnValue(0.0005);
    const res = await call(new OpenRouterProvider('k', { estimateCost }));

    expect(res.costBilledUsd).toBeCloseTo(0.002, 10);
    expect(res.costEstimatedUsd).toBeCloseTo(0.0005, 10);
    expect(res.costUsd).toBeCloseTo(0.0025, 10);
    expect(create).toHaveBeenCalledTimes(2);
    expect(estimateCost).toHaveBeenCalledTimes(1);
    expect(estimateCost).toHaveBeenCalledWith('m', 20, 7);
  });

  it.each([
    ['NaN', Number.NaN],
    ['negative', -1],
    ['string', '0.1'],
  ])('treats a %s usage.cost as not billed', async (_name, cost) => {
    create.mockResolvedValueOnce(reply('{"ok":true}', { prompt_tokens: 3, completion_tokens: 4, cost }));
    const res = await call(new OpenRouterProvider('k', { estimateCost: () => 0.0007 }));

    expect(res.costBilledUsd).toBe(0);
    expect(res.costEstimatedUsd).toBeCloseTo(0.0007, 10);
    expect(res.costUsd).toBeCloseTo(0.0007, 10);
  });

  it('gives null for all three when an attempt has neither a cost nor a price', async () => {
    create
      .mockResolvedValueOnce(reply('not json', { prompt_tokens: 1, completion_tokens: 1, cost: 0.001 }))
      .mockResolvedValueOnce(reply('{"ok":true}', { prompt_tokens: 1, completion_tokens: 1 }));
    const res = await call(new OpenRouterProvider('k', { estimateCost: () => null }));

    expect(res.costUsd).toBeNull();
    expect(res.costBilledUsd).toBeNull();
    expect(res.costEstimatedUsd).toBeNull();
  });

  it('does not call the estimator when the API reported a valid cost', async () => {
    create.mockResolvedValueOnce(reply('{"ok":true}', { prompt_tokens: 1, completion_tokens: 1, cost: 0 }));
    const estimateCost = vi.fn();
    const res = await call(new OpenRouterProvider('k', { estimateCost }));

    expect(estimateCost).not.toHaveBeenCalled();
    expect(res.costBilledUsd).toBe(0);
    expect(res.costEstimatedUsd).toBe(0);
  });
});
