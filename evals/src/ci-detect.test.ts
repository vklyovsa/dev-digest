/**
 * scripts/ci-detect.mjs decides which model-backed suites a pull request pays for. It locates the
 * repo from its own path, so each test runs a copy of it inside a throwaway tree.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { EVALS_DIR, REPO_ROOT } from "./artifacts/paths.js";
import type { WorkflowCase } from "./dsl/case.js";

const TREE: Record<string, string> = {
  ".claude/skills/covered/SKILL.md": "# covered",
  ".claude/skills/uncovered/SKILL.md": "# uncovered",
  ".claude/skills/routed/SKILL.md": "# routed",
  ".claude/agents/reviewer.md": "---\nname: reviewer\n---\n",
  ".claude/agents/planner.md": "---\nname: planner\n---\n",
  ".claude/agents/README.md": "# Agents",
  "evals/skills/covered/covered.eval.ts": "",
  "evals/agents/reviewer/reviewer.eval.ts": "",
  "evals/workflow/flow.eval.ts": "",
  "evals/workflow/flow.cases.ts":
    'export const cases = [{ skill: "routed", expectFilesRead: ["server/docs/routed.md"] }];',
};

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ci-detect-"));
  for (const [path, content] of Object.entries(TREE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  mkdirSync(join(root, "evals/scripts"), { recursive: true });
  copyFileSync(join(EVALS_DIR, "scripts/ci-detect.mjs"), join(root, "evals/scripts/ci-detect.mjs"));
});

function detect(changed: string[], extraEnv: Record<string, string> = {}) {
  // Inside GitHub Actions these two would send the outputs to the real job instead of stdout.
  const { GITHUB_OUTPUT: _output, GITHUB_STEP_SUMMARY: _summary, ...env } = process.env;
  const run = spawnSync("node", [join(root, "evals/scripts/ci-detect.mjs")], {
    env: { ...env, CHANGED_FILES: changed.join("\n"), ...extraEnv },
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  const out = Object.fromEntries(run.stdout.trim().split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2)));
  return {
    skills: JSON.parse(out.skills) as string[],
    agents: JSON.parse(out.agents) as string[],
    workflow: out.run_workflow === "true",
    skippedSkills: out.skipped_skills,
    skippedAgents: out.skipped_agents,
    log: run.stderr,
  };
}

describe("ci-detect", () => {
  test("a changed skill runs its own evals and nothing else", () => {
    expect(detect([".claude/skills/covered/SKILL.md"])).toMatchObject({
      skills: ["covered"],
      agents: [],
      workflow: false,
    });
  });

  test("a changed skill without evals is logged as SKIP, not run", () => {
    const result = detect([".claude/skills/uncovered/references/a.md"]);

    expect(result).toMatchObject({ skills: [], skippedSkills: "uncovered", workflow: false });
    expect(result.log).toContain("SKIP skill uncovered (no evals");
  });

  test("a changed agent definition runs its evals and the workflow tier", () => {
    expect(detect([".claude/agents/reviewer.md"])).toMatchObject({ agents: ["reviewer"], workflow: true });
  });

  test("a changed agent without evals is skipped but still runs the workflow tier", () => {
    expect(detect([".claude/agents/planner.md"])).toMatchObject({
      agents: [],
      skippedAgents: "planner",
      workflow: true,
    });
  });

  test("editing only an agent's cases does not run the workflow tier", () => {
    expect(detect(["evals/agents/reviewer/reviewer.cases.ts"])).toMatchObject({
      agents: ["reviewer"],
      workflow: false,
    });
  });

  test("the agents README is not an agent", () => {
    expect(detect([".claude/agents/README.md"])).toMatchObject({ agents: [], skippedAgents: "", workflow: false });
  });

  test.each(["CLAUDE.md", "AGENTS.md", "server/AGENTS.md", ".claude/settings.json", "evals/workflow/flow.cases.ts"])(
    "%s is part of the harness and runs the workflow tier only",
    (file) => {
      expect(detect([file])).toMatchObject({ skills: [], agents: [], workflow: true });
    },
  );

  test("a doc a workflow case expects to be read runs the workflow tier; another doc does not", () => {
    expect(detect(["server/docs/routed.md"]).workflow).toBe(true);
    expect(detect(["server/docs/other.md"]).workflow).toBe(false);
  });

  test("a skill a workflow case names runs the workflow tier", () => {
    expect(detect([".claude/skills/routed/SKILL.md"])).toMatchObject({ skippedSkills: "routed", workflow: true });
  });

  test.each(["evals/src/tasks.ts", "evals/pnpm-lock.yaml", ".github/workflows/evals.yml"])(
    "an engine change (%s) runs every suite that has evals",
    (file) => {
      expect(detect([file])).toMatchObject({ skills: ["covered"], agents: ["reviewer"], workflow: true });
    },
  );

  test("a unit test of the engine runs no model-backed suite", () => {
    expect(detect(["evals/src/records/stats.test.ts"])).toMatchObject({ skills: [], agents: [], workflow: false });
  });

  test("RUN_ALL runs every suite without a diff", () => {
    expect(detect([], { RUN_ALL: "true" })).toMatchObject({ skills: ["covered"], agents: ["reviewer"], workflow: true });
  });
});

// The `paths:` filter decides whether the workflow starts at all, before the detector runs, so a
// doc that a new workflow case asserts on has to be listed there too.
test("the CI path filter covers every doc a workflow case expects to be read", async () => {
  const dir = join(EVALS_DIR, "workflow");
  const modules = await Promise.all(
    readdirSync(dir)
      .filter((f) => f.endsWith(".cases.ts"))
      .map((f) => import(join(dir, f)) as Promise<{ cases: WorkflowCase[] }>),
  );
  const expected = modules
    .flatMap((m) => m.cases)
    .flatMap((c) => (c.kind === "trace" ? (c.expectFilesRead ?? []) : c.kind === "contrast" ? [c.expectFileRead] : []));
  const filter = readFileSync(join(REPO_ROOT, ".github/workflows/evals.yml"), "utf8");

  const uncovered = expected.filter((f) => !/(^|\/)(CLAUDE|AGENTS)\.md$/.test(f) && !filter.includes(`'${f}'`));

  expect(uncovered).toEqual([]);
});
