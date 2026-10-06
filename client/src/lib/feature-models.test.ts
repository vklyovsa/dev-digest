import { describe, it, expect } from "vitest";
import { FEATURE_MODELS } from "./feature-models";

describe("FEATURE_MODELS", () => {
  it("defaults risk_brief to the priced OpenRouter model the shared registry uses", () => {
    const row = FEATURE_MODELS.find((feature) => feature.id === "risk_brief");

    expect(row).toBeDefined();
    expect({ provider: row!.defaultProvider, model: row!.defaultModel }).toEqual({
      provider: "openrouter",
      model: "minimax/minimax-m2.5",
    });
  });
});
