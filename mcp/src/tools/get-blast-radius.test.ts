import { describe, expect, it } from 'vitest';
import { ToolError } from '../errors.js';
import { BLAST_RADIUS_NOT_IMPLEMENTED, getBlastRadius } from './get-blast-radius.js';

describe('getBlastRadius', () => {
  it('E14: always throws the not-implemented text, saying not to retry', () => {
    expect(() => getBlastRadius()).toThrow(ToolError);
    expect(() => getBlastRadius()).toThrow(
      'get_blast_radius is not implemented yet in this DevDigest build. Do not retry. No other tool on this server returns impact data; tell the user it is unavailable.',
    );
    expect(BLAST_RADIUS_NOT_IMPLEMENTED).toContain('Do not retry');
  });

  it('takes no port and no arguments, so it cannot reach the API', () => {
    expect(getBlastRadius.length).toBe(0);
  });
});
