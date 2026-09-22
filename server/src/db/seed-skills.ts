import type { SkillSource, SkillType } from '@devdigest/shared';

/**
 * Built-in skills used by the seed.
 *
 * A skill is TEXT that gets appended to an agent's prompt as one labelled
 * block — nothing here executes. These are the workspace-authored ones
 * (`manual` / `extracted`); third-party skills arrive through the import flow
 * instead, land disabled, and are listed in `modules/skills/community.ts`.
 *
 * `agents` names the seeded agents each skill is linked to, in the order they
 * appear in the prompt.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  agents: string[];
  body: string;
}

export const SEED_SKILLS: readonly SeedSkill[] = [
  {
    name: 'pr-quality-rubric',
    description: 'Evaluates overall PR quality across correctness, security, tests and scope.',
    type: 'rubric',
    source: 'manual',
    agents: ['General Reviewer', 'Security Reviewer', 'Performance Reviewer'],
    body: `# PR Quality Rubric

Evaluate the pull request against the following dimensions. For each, return a
finding only when the issue is **worth the author's time** — aim for a few
high-signal findings, not a list.

## Correctness
- Does the change do what the PR description claims?
- Are edge cases (empty input, nulls, concurrency) handled?

## Security
- Any secrets, tokens, or credentials in the diff?
- Untrusted input reaching a sink (SQL, shell, fetch)?

## Tests
- New branches covered by assertions?
- Are tests meaningful (not just snapshot churn)?

## Scope
- Does the diff stay within the stated intent?
- Flag out-of-scope changes separately rather than blocking.`,
  },
  {
    name: 'test-coverage-rubric',
    description:
      'Requires every branch added by the diff to have an assertion, and names the branch when one is missing.',
    type: 'rubric',
    source: 'manual',
    agents: ['Test Quality Reviewer'],
    body: `# Test coverage rubric

Before judging the tests, list every branch the diff ADDS: each \`if\`/\`else\`,
early return, \`catch\`, retry, guard clause and default value. Then check the
tests off against that list.

Report a finding for each branch with no assertion reaching it. The finding must
name:

1. the branch (file:line of the condition),
2. the input that takes it,
3. what goes wrong while the suite stays green.

Treat these as uncovered even when a test "touches" the function:

- a branch reached only through a mock that returns the happy value,
- an error path asserted with \`not.toThrow()\` instead of the error itself,
- a \`catch\` block whose body is never executed by any test.

A bug fix with no test that fails against the OLD code is an uncovered branch by
definition — the regression it prevents is the branch.

Do not ask for coverage of unreachable code or of behaviour this diff does not
introduce.`,
  },
  {
    name: 'edge-case-checklist',
    description:
      'Flags the boundary inputs a happy-path test suite leaves untested: empty, zero, negative, duplicate, concurrent and failing dependencies.',
    type: 'custom',
    source: 'manual',
    agents: ['Test Quality Reviewer'],
    body: `# Edge case checklist

For every function the diff adds or changes, walk this list and report the cases
the tests do not cover. Name the input, not the category.

**Collections** — empty, single element, first/last element, duplicates,
unsorted input where order is assumed, very large input.

**Scalars** — \`0\`, \`-1\`, \`NaN\`, \`Infinity\`, an empty string, a string of
whitespace, the maximum allowed length, one character past it.

**Absence** — \`null\`, \`undefined\`, a missing optional field, a field present
but empty. Distinguish "absent" from "present and falsy": \`??\` and \`||\` differ
exactly here.

**Time** — timezone and DST boundaries, leap day, a duration of zero, a
timestamp in the past when the code assumes the future.

**Dependencies** — every call out of the unit must be tested failing at least
once: timeout, non-2xx, malformed body, connection reset, empty result.

**Concurrency** — two calls in flight at once where the code assumes serial
execution; a second call before the first resolves.

A suite that only covers the success path of a function with a failure path is a
finding on its own — say which failure is untested and what a user would see.`,
  },
  {
    name: 'mock-overuse-gate',
    description:
      'Detects tests whose mocks remove the behaviour under test, so the assertion only proves the mock was configured.',
    type: 'custom',
    source: 'manual',
    agents: ['Test Quality Reviewer'],
    body: `# Mock overuse gate

A mock is a tool for isolating a boundary — a network call, a clock, a database.
Mocking anything else removes the behaviour the test claims to check.

Flag:

- **The unit under test is mocked.** The assertion then proves only that the
  mock was configured. This is CRITICAL: the test would pass with the production
  implementation deleted.
- **Assertion on the mock, not the system.** \`expect(mock).toHaveBeenCalledWith(…)\`
  as the only assertion — behaviour can change while the call shape stays.
- **Pure functions and in-memory structures mocked.** Nothing is isolated;
  the real implementation is never exercised.
- **The mock encodes the answer.** The stub returns the exact value the
  assertion expects, computed nowhere.
- **Deep stubbing.** A chain of mocks several layers below the unit, so the test
  passes regardless of how those layers behave.

Do not flag mocking of a genuine boundary (HTTP, fs, time, randomness, a paid
API). Say what the test proves today and what it would have to exercise to prove
the behaviour instead.`,
  },
  {
    name: 'test-naming-convention',
    description:
      'Requires a test name to state the behaviour and its condition, so a failure reads as a defect report.',
    type: 'convention',
    source: 'extracted',
    // Deliberately linked to NOBODY: the fourth skill a Test Quality Reviewer
    // needs arrives through the import flow (see specs/skills-control-experiment.md),
    // and an unlinked skill is what the Skills tab is for attaching.
    agents: [],
    body: `# Test naming convention

A test name is read when it FAILS, in a CI log, by someone who did not write it.
It must say what behaviour broke and under which condition.

Required shape: \`<subject> <expected behaviour> when <condition>\`.

Good: \`retries once when the first request times out\`.
Bad: \`works\`, \`test 2\`, \`handles errors\`, \`should be correct\`.

Flag a test whose name:

- names the implementation instead of the behaviour (\`calls fetchUser twice\`),
- states no condition while the test clearly sets one up,
- says "should" without an observable outcome,
- duplicates a sibling's name.

This is a SUGGESTION-level finding unless the name actively contradicts what the
test asserts, which is a WARNING — a misleading name costs more than a vague one.`,
  },
  {
    name: 'api-contract-gate',
    description:
      'Flags a route, handler or exported signature change that breaks existing callers without a version or migration path.',
    type: 'custom',
    source: 'manual',
    agents: ['General Reviewer'],
    body: `# API contract gate

Treat every HTTP route, exported function signature and response shape in the
diff as a published contract. A change that an existing caller cannot survive is
a breaking change, and a breaking change without a migration path is CRITICAL.

Flag when the diff:

- **Renames or removes** a route, a query/path parameter, a request field, or a
  response field that callers read.
- **Tightens validation**: a previously optional field made required, a widened
  enum narrowed, a default removed, a new minimum length or range.
- **Changes a type on the wire**: string → number, scalar → object, a single
  value → an array, \`null\` no longer permitted.
- **Changes status codes or error shapes**: a 200-with-empty-body becoming a
  404, an error envelope losing \`code\`.
- **Reorders or repurposes positional parameters** of an exported function.

For each, state: which caller breaks, what it sends today, and what it would
receive after the change. A breaking change IS acceptable when the diff also
carries a version bump, a deprecation window, or an adapter — say so instead of
flagging it.

Do not flag additive changes: a new optional field, a new endpoint, a widened
enum, a new nullable column.`,
  },
  {
    name: 'secret-leakage-gate',
    description:
      'Detects credentials committed in the diff — API keys, tokens, private keys and client-exposed server secrets.',
    type: 'security',
    source: 'manual',
    agents: ['Security Reviewer'],
    body: `# Secret leakage gate

Any credential that reaches version control is compromised: it lives in the
history, in every clone, and in CI logs. Treat a committed secret as CRITICAL
even when the PR says it is a test key.

Flag:

- Provider key prefixes: \`sk_live\`, \`sk_test\`, \`rk_\`, \`AKIA\`, \`ghp_\`,
  \`gho_\`, \`xoxb-\`, \`AIza\`, \`service_role\`.
- A private key block (\`BEGIN … PRIVATE KEY\`), a \`.pem\`, a keystore, a
  \`.env\` file with values.
- A server-only secret exposed to a client bundle — anything sensitive behind a
  \`NEXT_PUBLIC_\`, \`VITE_\`, or \`REACT_APP_\` prefix.
- A connection string with an inline password.
- A hard-coded fallback: \`process.env.TOKEN ?? "abc123"\`.
- A secret written into a log line, an error message, or a URL query parameter.

The remediation is always the same and always both halves: **revoke and rotate
the credential**, then remove it from the code and load it from configuration.
Removing it from the file alone leaves it valid in the history.

Do not flag an obvious placeholder (\`<your-key-here>\`, \`xxx\`, \`changeme\`) or
a public identifier such as a publishable key.`,
  },
];
