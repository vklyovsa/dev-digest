/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   the harness — any CLAUDE.md / AGENTS.md, .claude/settings.json, an agent definition,
 *     evals/workflow/**, a doc or skill a workflow case names → run the workflow tier
 *   the engine — evals/src, package.json, the lockfile, the proxy, a CI workflow —
 *     or $RUN_ALL=true (a manual run)                          → run every suite that has evals
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs and as a "SKIP <name> (no evals)" log line instead of going red.
 *
 * Emits GitHub Actions step outputs (skills, agents, run_workflow, skipped_skills, skipped_agents)
 * to $GITHUB_OUTPUT and a table to $GITHUB_STEP_SUMMARY. Pure filesystem + string work — no deps.
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(EVALS_DIR, "..");
const WORKFLOW_DIR = join(EVALS_DIR, "workflow");

const SKILL_DEF = /^\.claude\/skills\/([^/]+)\//;
// README.md in that folder documents the agents; it is not one.
const AGENT_DEF = /^\.claude\/agents\/(?!README\.md$)([^/]+)\.md$/;
const HARNESS = [/(^|\/)(CLAUDE|AGENTS)\.md$/, /^\.claude\/settings\.json$/, /^evals\/workflow\//];
// A change here can move any result, so it re-runs everything; unit tests of the engine cannot.
const ENGINE = [
  /^evals\/src\/(?!.*\.test\.ts$)/,
  /^evals\/(package\.json|pnpm-lock\.yaml|vitest\.config\.ts)$/,
  /^evals\/proxy\//,
  /^evals\/scripts\/litellm-proxy\.sh$/,
  /^\.github\/workflows\/eval-(skills|agents|workflow)\.yml$/,
];

const changed = (process.env.CHANGED_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
const list = (dir, suffix) => (isDir(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)) : []);

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
const hasEvals = (tier, name) => list(join(EVALS_DIR, tier, name), ".eval.ts").length > 0;

/** Every artifact of a tier that has evals. */
const allWithEvals = (tier) => list(join(EVALS_DIR, tier), "").filter((name) => hasEvals(tier, name)).sort();

/** Collect distinct artifact names captured by any of the patterns. */
function touched(...patterns) {
  const names = new Set();
  for (const f of changed) {
    const m = patterns.map((re) => f.match(re)).find(Boolean);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const workflowCases = list(WORKFLOW_DIR, ".cases.ts")
  .map((f) => readFileSync(join(WORKFLOW_DIR, f), "utf8"))
  .join("\n");

/** Is `value` a string literal in a workflow case — a doc it expects read, a skill it expects to engage? */
const namedByWorkflowCase = (value) => ['"', "'", "`"].some((q) => workflowCases.includes(q + value + q));

const editedSkills = touched(SKILL_DEF);
const editedAgents = touched(AGENT_DEF);
const skillNames = touched(SKILL_DEF, /^evals\/skills\/([^/]+)\//);
const agentNames = touched(AGENT_DEF, /^evals\/agents\/([^/]+)\//);

const runAll = process.env.RUN_ALL === "true" || changed.some((f) => ENGINE.some((re) => re.test(f)));

const skills = runAll ? allWithEvals("skills") : skillNames.filter((n) => hasEvals("skills", n));
const agents = runAll ? allWithEvals("agents") : agentNames.filter((n) => hasEvals("agents", n));
// Only an artifact that still exists is "skipped"; a deleted one with no evals is nothing to report.
const skippedSkills = skillNames.filter(
  (n) => !hasEvals("skills", n) && existsSync(join(REPO_ROOT, ".claude", "skills", n, "SKILL.md")),
);
const skippedAgents = agentNames.filter(
  (n) => !hasEvals("agents", n) && existsSync(join(REPO_ROOT, ".claude", "agents", `${n}.md`)),
);

// The workflow tier measures the LIVE harness, so anything a session loads or a case asserts on
// re-triggers it. A changed agent definition counts even without evals of its own: its
// description is what the dispatch cases route on.
const harnessChanged =
  editedAgents.length > 0 ||
  editedSkills.some(namedByWorkflowCase) ||
  changed.some((f) => HARNESS.some((re) => re.test(f)) || namedByWorkflowCase(f));
const runWorkflow = (runAll || harnessChanged) && list(WORKFLOW_DIR, ".eval.ts").length > 0;

const out = process.env.GITHUB_OUTPUT;
const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

write("skills", JSON.stringify(skills));
write("agents", JSON.stringify(agents));
write("run_workflow", String(runWorkflow));
write("skipped_skills", skippedSkills.join(" "));
write("skipped_agents", skippedAgents.join(" "));

// Human-readable summary in the step log.
console.error("── eval change detection ──");
console.error(`changed files : ${changed.length}${runAll ? " (engine change or manual run → every suite)" : ""}`);
console.error(`skills → run  : ${skills.join(", ") || "(none)"}`);
console.error(`agents → run  : ${agents.join(", ") || "(none)"}`);
console.error(`workflow tier : ${runWorkflow ? "run" : "skip"}`);
for (const n of skippedSkills) console.error(`SKIP skill ${n} (no evals in evals/skills/${n}/)`);
for (const n of skippedAgents) console.error(`SKIP agent ${n} (no evals in evals/agents/${n}/)`);

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const cell = (names) => names.map((n) => `\`${n}\``).join(", ") || "—";
  appendFileSync(
    summary,
    [
      "### Harness evals",
      "",
      "| Suite | Run | Skipped — no evals |",
      "|---|---|---|",
      `| skills | ${cell(skills)} | ${cell(skippedSkills)} |`,
      `| agents | ${cell(agents)} | ${cell(skippedAgents)} |`,
      `| workflow | ${runWorkflow ? "yes" : "no"} | — |`,
      "",
    ].join("\n"),
  );
}
