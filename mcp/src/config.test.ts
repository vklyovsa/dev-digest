import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { RUN_BUDGET_MS_DEFAULT, RUN_BUDGET_MS_MAX, RUN_BUDGET_MS_MIN } from './constants.js';

describe('loadConfig', () => {
  it('uses the loopback API and the default budget when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      apiUrl: 'http://127.0.0.1:3001',
      runBudgetMs: RUN_BUDGET_MS_DEFAULT,
    });
  });

  it('treats empty values as unset', () => {
    expect(loadConfig({ DEVDIGEST_API_URL: '  ', DEVDIGEST_MCP_RUN_TIMEOUT_MS: '' })).toEqual({
      apiUrl: 'http://127.0.0.1:3001',
      runBudgetMs: RUN_BUDGET_MS_DEFAULT,
    });
  });

  it.each([
    ['http://localhost:3101', 'http://localhost:3101'],
    ['http://127.0.0.1:3001/', 'http://127.0.0.1:3001'],
    ['http://127.0.0.1:3001///', 'http://127.0.0.1:3001'],
    ['http://[::1]:3001', 'http://[::1]:3001'],
    ['https://localhost', 'https://localhost'],
  ])('accepts %s', (input, expected) => {
    expect(loadConfig({ DEVDIGEST_API_URL: input }).apiUrl).toBe(expected);
  });

  it.each([
    'http://10.0.0.5:3001',
    'http://example.com',
    'http://0.0.0.0:3001',
    'http://127.0.0.1.evil.example',
    'http://localhost.evil.example',
    'http://evil.example#@127.0.0.1',
  ])('rejects the non-loopback host %s', (input) => {
    expect(() => loadConfig({ DEVDIGEST_API_URL: input })).toThrow(/must point at this machine/);
  });

  it('rejects other protocols', () => {
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'ftp://127.0.0.1' })).toThrow(/http: or https:/);
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'file:///etc/passwd' })).toThrow(/http: or https:/);
  });

  it('rejects an unparsable URL without echoing it', () => {
    const attempt = () => loadConfig({ DEVDIGEST_API_URL: 'not a url sk-secret-value' });
    expect(attempt).toThrow(/not a valid URL/);
    expect(attempt).not.toThrow(/sk-secret-value/);
  });

  it('rejects credentials in the URL without echoing them', () => {
    const attempt = () => loadConfig({ DEVDIGEST_API_URL: 'http://user:hunter2@127.0.0.1:3001' });
    expect(attempt).toThrow(/must not contain credentials/);
    expect(attempt).not.toThrow(/hunter2/);
  });

  it('clamps the run budget into [min, max]', () => {
    expect(loadConfig({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: '1' }).runBudgetMs).toBe(RUN_BUDGET_MS_MIN);
    expect(loadConfig({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: '0' }).runBudgetMs).toBe(RUN_BUDGET_MS_MIN);
    expect(loadConfig({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: '600000' }).runBudgetMs).toBe(RUN_BUDGET_MS_MAX);
    expect(loadConfig({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: '9'.repeat(400) }).runBudgetMs).toBe(
      RUN_BUDGET_MS_MAX,
    );
    expect(loadConfig({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: '45000' }).runBudgetMs).toBe(45_000);
    expect(loadConfig({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: ' 45000 ' }).runBudgetMs).toBe(45_000);
  });

  it.each(['abc', '-5', '1.5', '1e5', '0x10', '100 s'])('rejects the budget %j', (input) => {
    expect(() => loadConfig({ DEVDIGEST_MCP_RUN_TIMEOUT_MS: input })).toThrow(
      /whole number of milliseconds/,
    );
  });

  it('reads only its own two variables', () => {
    const backing: Record<string, string> = {
      DEVDIGEST_API_URL: 'http://127.0.0.1:3001',
      DEVDIGEST_MCP_RUN_TIMEOUT_MS: '30000',
      GITHUB_TOKEN: 'ghp_should_never_be_read',
      OPENAI_API_KEY: 'sk-should-never-be-read',
    };
    const read: string[] = [];
    const env = new Proxy(backing, {
      get(target, key) {
        read.push(String(key));
        return Reflect.get(target, key);
      },
    });

    const config = loadConfig(env);

    expect(config).toEqual({ apiUrl: 'http://127.0.0.1:3001', runBudgetMs: 30_000 });
    expect([...new Set(read)].sort()).toEqual(['DEVDIGEST_API_URL', 'DEVDIGEST_MCP_RUN_TIMEOUT_MS']);
  });
});
