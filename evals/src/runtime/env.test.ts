import { afterEach, describe, expect, test, vi } from "vitest";

const SLUG = "google/gemini-2.5-flash";

// env.ts reads EVAL_BACKEND once, at import.
async function envFor(vars: Record<string, string>, model?: string) {
  vi.resetModules();
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  const { subscriptionEnv } = await import("./env.js");
  return subscriptionEnv(model);
}

describe("subscriptionEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("openrouter pins the model aliases and the subagent model to the session's slug", async () => {
    const env = await envFor({ EVAL_BACKEND: "openrouter", OPENROUTER_API_KEY: "key" }, SLUG);

    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: "key",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_DEFAULT_FABLE_MODEL: SLUG,
      ANTHROPIC_DEFAULT_OPUS_MODEL: SLUG,
      ANTHROPIC_DEFAULT_SONNET_MODEL: SLUG,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: SLUG,
      CLAUDE_CODE_SUBAGENT_MODEL: SLUG,
    });
  });

  test("openrouter overwrites the empty overrides a Claude Code session exports", async () => {
    const env = await envFor(
      { EVAL_BACKEND: "openrouter", OPENROUTER_API_KEY: "key", CLAUDE_CODE_SUBAGENT_MODEL: "", ANTHROPIC_DEFAULT_SONNET_MODEL: "" },
      SLUG,
    );

    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe(SLUG);
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(SLUG);
  });

  test("subscription strips the API credentials and leaves the model overrides alone", async () => {
    const env = await envFor(
      { EVAL_BACKEND: "subscription", ANTHROPIC_API_KEY: "sk-ant", ANTHROPIC_AUTH_TOKEN: "t", CLAUDE_CODE_SUBAGENT_MODEL: "inherited" },
      "claude-sonnet-5",
    );

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("inherited");
  });
});
