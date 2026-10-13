import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { DEFAULT_WORKSPACE_NAME } from './seed.js';

/**
 * Fixture eval cases for ONE named agent. Started by hand:
 *
 *   pnpm exec tsx src/db/eval-fixtures.ts --agent "<name>"
 *
 * Additive and idempotent: inserts the cases the agent does not hold yet (by
 * name) and changes no other row. Never called by the seed, `dev.sh` or the API.
 */

type ExpectationType = 'must_find' | 'must_not_flag';

interface FixtureSpec {
  name: string;
  type: ExpectationType;
  file: string;
  /** Context line above the changed line; the changed line is the next new-file line. */
  before: string;
  added: string;
  after: string;
  startLine: number;
  severity: string;
  category: string;
  title: string;
  prTitle: string;
}

const FIXTURES: FixtureSpec[] = [
  {
    name: 'fixture-must-find-hardcoded-stripe-key',
    type: 'must_find',
    file: 'src/config.ts',
    before: '  port: 3000,',
    added: '  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",',
    after: '  redisUrl: process.env.REDIS_URL,',
    startLine: 11,
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe secret key',
    prTitle: 'Add payment configuration',
  },
  {
    name: 'fixture-must-find-sql-string-concat',
    type: 'must_find',
    file: 'src/users/repository.ts',
    before: 'export async function findUser(db: Db, name: string) {',
    added: '  return db.query(`SELECT * FROM users WHERE name = \'${name}\'`);',
    after: '}',
    startLine: 21,
    severity: 'CRITICAL',
    category: 'security',
    title: 'SQL built by string concatenation',
    prTitle: 'Add user lookup by name',
  },
  {
    name: 'fixture-must-find-missing-await',
    type: 'must_find',
    file: 'src/billing/charge.ts',
    before: 'export async function charge(id: string) {',
    added: '  gateway.capture(id);',
    after: '  return { ok: true };',
    startLine: 31,
    severity: 'WARNING',
    category: 'bug',
    title: 'Promise from capture() is not awaited',
    prTitle: 'Capture payments on charge',
  },
  {
    name: 'fixture-must-find-empty-catch',
    type: 'must_find',
    file: 'src/jobs/sync.ts',
    before: '  } catch (err) {',
    added: '    // ignored',
    after: '  }',
    startLine: 41,
    severity: 'WARNING',
    category: 'bug',
    title: 'Error swallowed by an empty catch block',
    prTitle: 'Make the sync job tolerant',
  },
  {
    name: 'fixture-no-flag-renamed-variable',
    type: 'must_not_flag',
    file: 'src/utils/format.ts',
    before: 'export function label(count: number) {',
    added: '  const itemCount = count;',
    after: '  return `${itemCount} items`;',
    startLine: 51,
    severity: 'INFO',
    category: 'style',
    title: 'Variable renamed',
    prTitle: 'Rename a local variable',
  },
  {
    name: 'fixture-no-flag-env-read',
    type: 'must_not_flag',
    file: 'src/config.ts',
    before: 'export const config = {',
    added: '  apiUrl: process.env.API_URL ?? "http://localhost:3001",',
    after: '};',
    startLine: 61,
    severity: 'WARNING',
    category: 'security',
    title: 'Configuration read from the environment',
    prTitle: 'Read the API url from the environment',
  },
  {
    name: 'fixture-no-flag-typed-constant',
    type: 'must_not_flag',
    file: 'src/limits.ts',
    before: 'export const LIMITS = {',
    added: '  maxItems: 100 as const,',
    after: '};',
    startLine: 71,
    severity: 'INFO',
    category: 'style',
    title: 'Magic number',
    prTitle: 'Add an item limit',
  },
  {
    name: 'fixture-no-flag-logging-line',
    type: 'must_not_flag',
    file: 'src/server.ts',
    before: 'export async function start() {',
    added: '  logger.info({ port }, "listening");',
    after: '  await app.listen({ port });',
    startLine: 81,
    severity: 'INFO',
    category: 'style',
    title: 'Log statement added',
    prTitle: 'Log the listening port',
  },
];

function fixtureDiff(spec: FixtureSpec): string {
  const oldStart = spec.startLine - 1;
  return [
    `diff --git a/${spec.file} b/${spec.file}`,
    `--- a/${spec.file}`,
    `+++ b/${spec.file}`,
    `@@ -${oldStart},2 +${oldStart},3 @@`,
    ` ${spec.before}`,
    `+${spec.added}`,
    ` ${spec.after}`,
    '',
  ].join('\n');
}

export const EVAL_FIXTURE_CASES = FIXTURES.map((spec) => ({
  name: spec.name,
  expectationType: spec.type,
  expectedOutput: {
    file: spec.file,
    start_line: spec.startLine,
    end_line: spec.startLine,
    severity: spec.severity,
    category: spec.category,
    title: spec.title,
  },
  inputDiff: fixtureDiff(spec),
  inputFiles: [spec.file],
  inputMeta: {
    pr_number: 1,
    pr_title: spec.prTitle,
    pr_author: 'fixture',
    pr_body: null,
  },
}));

/** Inserts the fixture cases the agent does not hold yet; returns how many it inserted. */
export async function insertEvalFixtures(
  db: Db,
  workspaceId: string,
  agentId: string,
): Promise<number> {
  const held = await db
    .select({ name: t.evalCases.name })
    .from(t.evalCases)
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        eq(t.evalCases.ownerId, agentId),
      ),
    );
  const heldNames = new Set(held.map((row) => row.name));
  const missing = EVAL_FIXTURE_CASES.filter((fixture) => !heldNames.has(fixture.name));
  if (missing.length === 0) return 0;

  await db.insert(t.evalCases).values(
    missing.map((fixture) => ({
      workspaceId,
      ownerKind: 'agent' as const,
      ownerId: agentId,
      name: fixture.name,
      expectationType: fixture.expectationType,
      expectedOutput: fixture.expectedOutput,
      inputDiff: fixture.inputDiff,
      inputFiles: fixture.inputFiles,
      inputMeta: fixture.inputMeta,
      sourceFindingId: null,
      notes: null,
    })),
  );
  return missing.length;
}

export function agentNameFromArgs(argv: string[]): string | null {
  const index = argv.indexOf('--agent');
  const value = index === -1 ? undefined : argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

/** Resolves the default workspace and the named agent, then inserts; `null` when either is missing. */
export async function runEvalFixtures(db: Db, agentName: string): Promise<number | null> {
  const [workspace] = await db
    .select({ id: t.workspaces.id })
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!workspace) return null;
  const [agent] = await db
    .select({ id: t.agents.id })
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspace.id), eq(t.agents.name, agentName)));
  if (!agent) return null;
  return insertEvalFixtures(db, workspace.id, agent.id);
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const agentName = agentNameFromArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!agentName) {
    console.error('--agent "<name>" is required');
    process.exit(1);
  }
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  runEvalFixtures(handle.db, agentName)
    .then(async (inserted) => {
      await handle.close();
      if (inserted === null) {
        console.error(`✗ workspace or agent "${agentName}" not found`);
        process.exit(1);
      }
      console.log(`✓ inserted ${inserted} fixture eval case(s) for "${agentName}"`);
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ eval fixtures failed:', err);
      await handle.close();
      process.exit(1);
    });
}
