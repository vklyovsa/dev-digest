ALTER TABLE "eval_runs" DROP CONSTRAINT "eval_runs_case_id_eval_cases_id_fk";--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "case_id";--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "actual_output";--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "pass";--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expectation_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "status" text DEFAULT 'running' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "cases_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "cases_passed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "cases_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "cases_errored" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "findings_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "findings_grounded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "provider" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "model" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "case_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "results" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_owner_idx" ON "eval_cases" USING btree ("owner_kind","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_source_finding_uq" ON "eval_cases" USING btree ("source_finding_id") WHERE source_finding_id is not null;--> statement-breakpoint
CREATE INDEX "eval_runs_agent_ran_idx" ON "eval_runs" USING btree ("agent_id","ran_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_one_running_idx" ON "eval_runs" USING btree ("agent_id") WHERE status = 'running';
