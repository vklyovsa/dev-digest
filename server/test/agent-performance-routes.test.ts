import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const ID = '00000000-0000-4000-8000-000000000001';
const FROM = '2026-10-01T00:00:00.000Z';
const TO = '2026-10-02T00:00:00.000Z';

const QUERIES: [string, string][] = [
  ['from missing', `to=${TO}`],
  ['to missing', `from=${FROM}`],
  ['from not a date-time', `from=yesterday&to=${TO}`],
  ['from equals to', `from=${FROM}&to=${FROM}`],
  ['from after to', `from=${TO}&to=${FROM}`],
];

describe('agent performance routes: query validation (no DB)', () => {
  for (const [name, query] of QUERIES) {
    it(`GET /agents/performance answers 422 when ${name}`, async () => {
      const app = await buildApp({ config });
      const res = await app.inject({ method: 'GET', url: `/agents/performance?${query}` });
      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it(`GET /agents/:id/stats answers 422 when ${name}`, async () => {
      const app = await buildApp({ config });
      const res = await app.inject({ method: 'GET', url: `/agents/${ID}/stats?${query}` });
      expect(res.statusCode).toBe(422);
      await app.close();
    });
  }

  it('GET /agents/not-a-uuid/stats answers 422', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'GET',
      url: `/agents/not-a-uuid/stats?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
