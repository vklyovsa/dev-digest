import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

const openaiCreate = vi.hoisted(() => vi.fn());
const anthropicCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: openaiCreate } };
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropicCreate };
  },
}));

import { OpenAIProvider } from '../src/adapters/llm/openai.js';
import { AnthropicProvider } from '../src/adapters/llm/anthropic.js';
import { estimatedOnly } from '../src/adapters/llm/pricing.js';

const Schema = z.object({ ok: z.boolean() });

describe('estimatedOnly', () => {
  it('maps a priced call to billed 0 and a null call to all null', () => {
    expect(estimatedOnly(0.5)).toEqual({ costUsd: 0.5, costBilledUsd: 0, costEstimatedUsd: 0.5 });
    expect(estimatedOnly(null)).toEqual({ costUsd: null, costBilledUsd: null, costEstimatedUsd: null });
  });
});

describe('structured cost parts of the direct adapters', () => {
  it('OpenAI reports the whole cost as estimated', async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    });
    const res = await new OpenAIProvider('k').completeStructured({
      model: 'gpt-4.1',
      schema: Schema,
      schemaName: 'Probe',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.costUsd).not.toBeNull();
    expect(res.costBilledUsd).toBe(0);
    expect(res.costEstimatedUsd).toBe(res.costUsd);
  });

  it('Anthropic reports the whole cost as estimated', async () => {
    anthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', input: { ok: true } }],
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    const res = await new AnthropicProvider('k').completeStructured({
      model: 'claude-3-5-haiku-latest',
      schema: Schema,
      schemaName: 'Probe',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.costUsd).not.toBeNull();
    expect(res.costBilledUsd).toBe(0);
    expect(res.costEstimatedUsd).toBe(res.costUsd);
  });
});
