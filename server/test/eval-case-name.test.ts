import { describe, it, expect } from 'vitest';
import { evalCaseName } from '../src/modules/eval/helpers.js';

describe('evalCaseName (AC-6)', () => {
  it('cuts the slug to 34 characters and trims nothing', () => {
    const name = evalCaseName('must_find', 'Hardcoded Stripe secret key in commit');
    expect(name).toBe('must-find-hardcoded-stripe-secret-key-in-com');
    expect(name.slice('must-find-'.length)).toHaveLength(34);
  });

  it('prefixes a must_not_flag case with no-', () => {
    expect(evalCaseName('must_not_flag', 'Hardcoded Stripe secret key in commit')).toBe(
      'no-hardcoded-stripe-secret-key-in-com',
    );
  });
});
