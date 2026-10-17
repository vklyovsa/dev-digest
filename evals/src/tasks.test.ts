import { readdirSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { agentDisallowedTools } from "./artifacts/load.js";
import { AGENTS_DIR } from "./artifacts/paths.js";
import { runClaude } from "./runtime/run-claude.js";
import { agentTask, workflowTask } from "./tasks.js";

vi.mock("./runtime/run-claude.js", () => ({ runClaude: vi.fn() }));
vi.mock("./runtime/dispatch.js", () => ({ runContent: vi.fn() }));

const MUTATING = ["Bash", "Write", "Edit", "NotebookEdit"];
const anAgent = readdirSync(AGENTS_DIR)
  .find((f) => f.endsWith(".md") && f !== "README.md")!
  .replace(/\.md$/, "");

beforeEach(() => vi.mocked(runClaude).mockReset());

// Sessions run with bypassPermissions against the live repo, where leaving a tool out of
// allowedTools does not stop it: only the deny-list does.
test.each([
  ["agentTask", () => agentTask("prompt", anAgent)],
  ["workflowTask", () => workflowTask("prompt")],
])("%s denies Bash and the write tools", (_name, run) => {
  run();

  const options = vi.mocked(runClaude).mock.calls[0][1]!;
  expect(options.disallowedTools).toEqual(expect.arrayContaining(MUTATING));
  expect(options.allowedTools).not.toEqual(expect.arrayContaining(["Bash"]));
});

test("agentTask also denies the tools the agent forbids itself in frontmatter", () => {
  agentTask("prompt", "architecture-reviewer");

  expect(agentDisallowedTools("architecture-reviewer")).toContain("Agent");
  expect(vi.mocked(runClaude).mock.calls[0][1]!.disallowedTools).toContain("Agent");
});
