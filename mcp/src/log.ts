import type { LogFields, Logger } from './ports.js';

type Level = 'info' | 'warn' | 'error';

function line(level: Level, event: string, fields: LogFields | undefined): string {
  const base = { ts: new Date().toISOString(), level, event };
  try {
    return JSON.stringify({ ...fields, ...base });
  } catch {
    return JSON.stringify({ ...base, note: 'fields not serializable' });
  }
}

export function createStderrLogger(): Logger {
  const write = (level: Level, event: string, fields?: LogFields): void => {
    process.stderr.write(`${line(level, event, fields)}\n`);
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
