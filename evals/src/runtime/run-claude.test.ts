import { homedir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { beforeEach, expect, test, vi } from "vitest";
import { runClaude } from "./run-claude.js";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(query).mockImplementation((() => (async function* () {})()) as never);
});

// A session that loads the developer's ~/.claude/CLAUDE.md or auto-memory measures that developer,
// not the harness: every tier has to keep them out, whatever settingSources it asks for.
test.each([
  ["an isolated run", undefined],
  ["a run on the project harness", ["project"] as const],
])("%s keeps the developer's own instructions and auto-memory out", async (_name, settingSources) => {
  await runClaude("prompt", { allowedTools: ["Read"], settingSources: settingSources && [...settingSources] });

  const { options } = vi.mocked(query).mock.calls[0][0];
  expect(options?.settings).toEqual({
    claudeMdExcludes: [join(homedir(), ".claude", "**")],
    autoMemoryEnabled: false,
  });
});
