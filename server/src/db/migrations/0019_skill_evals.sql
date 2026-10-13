DROP INDEX "eval_runs_one_running_idx";--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "skill_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "skill_version" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_one_running_agent_idx" ON "eval_runs" USING btree ("agent_id") WHERE status = 'running' and skill_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_one_running_skill_idx" ON "eval_runs" USING btree ("skill_id") WHERE status = 'running' and skill_id is not null;--> statement-breakpoint
CREATE INDEX "eval_runs_skill_ran_idx" ON "eval_runs" USING btree ("skill_id","ran_at");