import { describe, expect, it } from 'vitest';
import { ToolError } from './errors.js';
import { resolveAgent, resolvePull, resolveRepo } from './resolve.js';
import { fakeAgent, fakePull, fakeRepo } from './testing/fake-api.js';

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    return (err as ToolError).message;
  }
  throw new Error('expected the resolver to throw');
}

describe('resolveAgent', () => {
  const security = fakeAgent({ id: 'a-sec', name: 'Security Reviewer', model: 'm/sec' });
  const quality = fakeAgent({ id: 'a-q', name: 'Test Quality Reviewer', model: 'm/q' });

  it('resolves by exact id', () => {
    expect(resolveAgent([security, quality], 'a-q')).toBe(quality);
  });

  it('resolves by exact name, ignoring case and surrounding spaces', () => {
    expect(resolveAgent([security, quality], 'security reviewer')).toBe(security);
    expect(resolveAgent([security, quality], '  TEST QUALITY REVIEWER ')).toBe(quality);
  });

  it('prefers an id match over a name match', () => {
    const trap = fakeAgent({ id: 'a-trap', name: 'a-sec' });
    expect(resolveAgent([trap, security], 'a-sec')).toBe(security);
  });

  it('E1: an unknown agent points to list_agents', () => {
    const message = messageOf(() => resolveAgent([security], 'Nope'));
    expect(message).toBe('Agent "Nope" not found. Call list_agents and pass one of its ids.');
    expect(message).toContain('list_agents');
  });

  it('E1: a partial name is not a match', () => {
    expect(messageOf(() => resolveAgent([security], 'Security'))).toContain('not found');
    expect(messageOf(() => resolveAgent([], 'Security Reviewer'))).toContain('list_agents');
  });

  it('E2: an ambiguous name lists the ids and models to pick from', () => {
    const twin = fakeAgent({ id: 'a-sec-2', name: 'security reviewer', model: 'm/other' });
    const message = messageOf(() => resolveAgent([security, twin, quality], 'Security Reviewer'));
    expect(message).toBe(
      'Agent name "Security Reviewer" matches 2 agents. Pass an id instead: a-sec (m/sec), a-sec-2 (m/other).',
    );
  });

  it('E2: caps the list at 10 ids', () => {
    const many = Array.from({ length: 13 }, (_, i) => fakeAgent({ id: `id-${i}`, name: 'Same', model: 'm' }));
    const message = messageOf(() => resolveAgent(many, 'same'));
    expect(message).toContain('matches 13 agents');
    expect(message).toContain('id-9 (m)');
    expect(message).not.toContain('id-10');
    expect(message).toContain('+3 more');
  });

  it('clips and cleans the echoed value', () => {
    const message = messageOf(() => resolveAgent([], `x\n${'y'.repeat(500)}`));
    expect(message.length).toBeLessThan(250);
    expect(message).not.toContain('\n');
  });
});

describe('resolveRepo', () => {
  const payments = fakeRepo({ id: 'r-pay', fullName: 'acme/payments-api' });
  const web = fakeRepo({ id: 'r-web', fullName: 'Acme/Web' });

  it('resolves an exact full name', () => {
    expect(resolveRepo([payments, web], 'acme/payments-api')).toBe(payments);
  });

  it('resolves ignoring case and returns the stored spelling', () => {
    expect(resolveRepo([payments, web], 'ACME/PAYMENTS-API')).toBe(payments);
    expect(resolveRepo([payments, web], 'acme/web').fullName).toBe('Acme/Web');
  });

  it('prefers the exact spelling when two repos differ only by case', () => {
    const upper = fakeRepo({ id: 'r-up', fullName: 'Acme/Tool' });
    const lower = fakeRepo({ id: 'r-low', fullName: 'acme/tool' });
    expect(resolveRepo([upper, lower], 'acme/tool')).toBe(lower);
  });

  it.each(['acme', 'a/b/c', '', '   ', 'acme/', '/name', 'acme/ name', 'acme/na me', 'https://github.com/acme/x'])(
    'E4: rejects the malformed value %j before looking anything up',
    (value) => {
      const message = messageOf(() => resolveRepo([payments], value));
      expect(message).toContain('repo must look like "owner/name"');
    },
  );

  it('E3: lists the known repositories and the way forward', () => {
    const message = messageOf(() => resolveRepo([payments, web], 'acme/unknown'));
    expect(message).toBe(
      'Repository "acme/unknown" is not in DevDigest. Known repositories: acme/payments-api, Acme/Web. Use one of these exactly, or add the repository in the DevDigest UI first.',
    );
  });

  it('E3: caps the known list at 10', () => {
    const many = Array.from({ length: 12 }, (_, i) => fakeRepo({ id: `r${i}`, fullName: `o/r${i}` }));
    const message = messageOf(() => resolveRepo(many, 'o/missing'));
    expect(message).toContain('o/r9');
    expect(message).not.toContain('o/r10');
    expect(message).toContain('+2 more');
  });

  it('E3: says so when nothing is imported at all', () => {
    const message = messageOf(() => resolveRepo([], 'acme/x'));
    expect(message).toContain('no repository is imported yet');
    expect(message).toContain('DevDigest UI');
  });
});

describe('resolvePull', () => {
  const pulls = [
    fakePull({ id: 'p-1', number: 1, title: 'First' }),
    fakePull({ id: 'p-482', number: 482, title: 'Add rate limiting' }),
    fakePull({ id: null, number: 9, title: 'Not imported' }),
  ];

  it('resolves by number and returns the pull request id', () => {
    expect(resolvePull(pulls, 'acme/payments-api', 482)).toEqual({
      id: 'p-482',
      number: 482,
      title: 'Add rate limiting',
    });
  });

  it('E5: lists the known numbers, newest first, and explains how PRs get in', () => {
    const message = messageOf(() => resolvePull(pulls, 'acme/payments-api', 7));
    expect(message).toBe(
      'PR #7 not found in acme/payments-api. DevDigest knows PRs: #482, #1. Check the number (gh pr list); only PRs imported into DevDigest can be reviewed, and importing needs a GitHub token in Settings.',
    );
  });

  it('E5: a pull request without an id is not reviewable and is not offered', () => {
    const message = messageOf(() => resolvePull(pulls, 'acme/payments-api', 9));
    expect(message).toContain('PR #9 not found');
    expect(message).not.toContain('#9,');
    expect(message).toContain('#482, #1.');
  });

  it('E5: caps the known list at 10', () => {
    const many = Array.from({ length: 14 }, (_, i) => fakePull({ id: `p${i}`, number: i + 1 }));
    const message = messageOf(() => resolvePull(many, 'o/r', 99));
    expect(message).toContain('#14, #13');
    expect(message).toContain('#5, +4 more');
    expect(message).not.toContain('#4,');
  });

  it('E5: says so when the repository has no pull requests yet', () => {
    const message = messageOf(() => resolvePull([], 'acme/payments-api', 1));
    expect(message).toContain('DevDigest has no PRs for this repository yet.');
    expect(message).toContain('GitHub token in Settings');
  });
});
