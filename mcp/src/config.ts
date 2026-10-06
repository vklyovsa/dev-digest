import { RUN_BUDGET_MS_DEFAULT, RUN_BUDGET_MS_MAX, RUN_BUDGET_MS_MIN } from './constants.js';

export interface Config {
  readonly apiUrl: string;
  readonly runBudgetMs: number;
}

export type Env = Readonly<Record<string, string | undefined>>;

const API_URL_VAR = 'DEVDIGEST_API_URL';
const RUN_TIMEOUT_VAR = 'DEVDIGEST_MCP_RUN_TIMEOUT_MS';
const DEFAULT_API_URL = 'http://127.0.0.1:3001';
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseApiUrl(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_API_URL;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${API_URL_VAR} is not a valid URL. Example: ${DEFAULT_API_URL}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${API_URL_VAR} must use http: or https: (got ${url.protocol}).`);
  }
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      `${API_URL_VAR} must point at this machine (localhost, 127.0.0.1 or [::1]); got host "${url.hostname}".`,
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`${API_URL_VAR} must not contain credentials.`);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function parseRunBudget(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return RUN_BUDGET_MS_DEFAULT;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${RUN_TIMEOUT_VAR} must be a whole number of milliseconds.`);
  }
  return Math.min(RUN_BUDGET_MS_MAX, Math.max(RUN_BUDGET_MS_MIN, Number(value)));
}

export function loadConfig(env: Env): Config {
  return {
    apiUrl: parseApiUrl(env[API_URL_VAR]),
    runBudgetMs: parseRunBudget(env[RUN_TIMEOUT_VAR]),
  };
}
