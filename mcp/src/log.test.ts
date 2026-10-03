import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStderrLogger } from './log.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createStderrLogger', () => {
  it('writes one JSON line per event to stderr', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const log = createStderrLogger();
    log.info('run.started', { run_id: 'r1' });
    log.warn('run.slow');
    log.error('run.failed', { reason: 'boom' });

    expect(stderr).toHaveBeenCalledTimes(3);
    const lines = stderr.mock.calls.map(([chunk]) => String(chunk));
    for (const line of lines) {
      expect(line.endsWith('\n')).toBe(true);
      expect(line.trimEnd()).not.toContain('\n');
    }
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ level: 'info', event: 'run.started', run_id: 'r1' });
    expect(JSON.parse(lines[1] ?? '')).toMatchObject({ level: 'warn', event: 'run.slow' });
    expect(JSON.parse(lines[2] ?? '')).toMatchObject({ level: 'error', event: 'run.failed', reason: 'boom' });
  });

  it('keeps ts, level and event authoritative over caller fields', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    createStderrLogger().info('real.event', { level: 'fake', event: 'fake.event' });

    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      level: 'info',
      event: 'real.event',
    });
  });

  it('does not throw on fields that cannot be serialized', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;

    expect(() => createStderrLogger().error('bad.fields', cyclic)).not.toThrow();
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      event: 'bad.fields',
      note: 'fields not serializable',
    });
  });
});
