import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { agents } from './agents';
import { skills } from './skills';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

type EvalExpectedOutput = {
  file: string;
  start_line: number;
  end_line: number;
  severity: string;
  category: string;
  title: string;
};

type EvalInputMeta = {
  pr_number: number | null;
  pr_title: string;
  pr_author: string | null;
  pr_body: string | null;
};

type EvalRunOutcome = {
  case_id: string;
  case_name: string;
  case_revision?: number;
  expectation_type: 'must_find' | 'must_not_flag';
  status: 'pass' | 'fail' | 'error';
  matched: number;
  produced: number;
  findings: EvalExpectedOutput[];
  error: string | null;
};

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files').$type<string[]>(),
    inputMeta: jsonb('input_meta').$type<EvalInputMeta>(),
    expectedOutput: jsonb('expected_output').$type<EvalExpectedOutput>(),
    notes: text('notes'),
    revision: integer('revision').notNull().default(1),
    expectationType: text('expectation_type', { enum: ['must_find', 'must_not_flag'] }).notNull(),
    // No foreign key: a case outlives its finding, review and PR (AC-12).
    sourceFindingId: uuid('source_finding_id'),
    createdAt: now(),
  },
  (t) => ({
    ownerIdx: index('eval_cases_owner_idx').on(t.ownerKind, t.ownerId),
    sourceFindingUq: uniqueIndex('eval_cases_source_finding_uq')
      .on(t.sourceFindingId)
      .where(sql`source_finding_id is not null`),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    agentVersion: integer('agent_version').notNull(),
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'cascade' }),
    skillVersion: integer('skill_version'),
    status: text('status', { enum: ['running', 'done', 'failed'] })
      .notNull()
      .default('running'),
    error: text('error'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    casesTotal: integer('cases_total').notNull().default(0),
    casesPassed: integer('cases_passed').notNull().default(0),
    casesFailed: integer('cases_failed').notNull().default(0),
    casesErrored: integer('cases_errored').notNull().default(0),
    findingsTotal: integer('findings_total').notNull().default(0),
    findingsGrounded: integer('findings_grounded').notNull().default(0),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    skills: jsonb('skills').$type<string[]>().notNull().default([]),
    caseIds: jsonb('case_ids').$type<string[]>().notNull().default([]),
    results: jsonb('results').$type<EvalRunOutcome[]>().notNull().default([]),
  },
  (t) => ({
    agentRanIdx: index('eval_runs_agent_ran_idx').on(t.agentId, t.ranAt),
    // At most one agent's own run in flight per agent, refused by the database itself.
    oneRunningAgent: uniqueIndex('eval_runs_one_running_agent_idx')
      .on(t.agentId)
      .where(sql`status = 'running' and skill_id is null`),
    // At most one run in flight per skill, whichever agent hosts it.
    oneRunningSkill: uniqueIndex('eval_runs_one_running_skill_idx')
      .on(t.skillId)
      .where(sql`status = 'running' and skill_id is not null`),
    skillRanIdx: index('eval_runs_skill_ran_idx').on(t.skillId, t.ranAt),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
