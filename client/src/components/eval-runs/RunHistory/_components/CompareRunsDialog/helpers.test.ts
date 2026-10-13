import { describe, it, expect } from "vitest";
import type { EvalCompareSide, EvalSkillCompareSide } from "@devdigest/shared";
import { compareView } from "./helpers";

const agentSide = (over: Partial<EvalCompareSide> = {}): EvalCompareSide => ({
  run_id: "r1",
  agent_version: 1,
  system_prompt: "a",
  provider: "p",
  model: "m",
  skills: [],
  started_at: "2026-10-01T00:00:00Z",
  recall: null,
  precision: null,
  citation_accuracy: null,
  cost_usd: null,
  cases_total: 1,
  cases_passed: 1,
  ...over,
});

const skillSide = (over: Partial<EvalSkillCompareSide> = {}): EvalSkillCompareSide => ({
  run_id: "r1",
  skill_version: 3,
  skill_body: "old",
  agent_id: "h1",
  agent_version: 2,
  provider: "p",
  model: "m",
  started_at: "2026-10-01T00:00:00Z",
  recall: null,
  precision: null,
  citation_accuracy: null,
  cost_usd: null,
  cases_total: 1,
  cases_passed: 1,
  ...over,
});

const cases = { cases_only_in_base: [], cases_only_in_head: [], cases_edited: [] };

describe("compareView", () => {
  it("reads an agent comparison: prompts, versions and the differing provider, model and skills", () => {
    const view = compareView({
      kind: "agent",
      none: "—",
      data: {
        base: agentSide({ skills: ["x"] }),
        head: agentSide({ run_id: "r2", agent_version: 2, system_prompt: "b", model: "n" }),
        ...cases,
      },
    });
    expect(view).toMatchObject({ baseVersion: 1, headVersion: 2, baseText: "a", headText: "b", sameText: false });
    expect(view.configRows).toEqual([
      { id: "model", from: "m", to: "n" },
      { id: "skills", from: "x", to: "—" },
    ]);
  });

  it("calls two equal prompts the same text", () => {
    const view = compareView({ kind: "agent", none: "—", data: { base: agentSide(), head: agentSide(), ...cases } });
    expect(view.sameText).toBe(true);
    expect(view.configRows).toEqual([]);
  });

  it("reads a skill comparison: bodies, skill versions, host names and the differing rows only", () => {
    const view = compareView({
      kind: "skill",
      none: "—",
      hostNames: new Map([["h1", "Security Reviewer"]]),
      data: {
        base: skillSide(),
        head: skillSide({ run_id: "r2", skill_version: 4, skill_body: "new", agent_id: "h2", model: "n" }),
        ...cases,
      },
    });
    expect(view).toMatchObject({ baseVersion: 3, headVersion: 4, baseText: "old", headText: "new", sameText: false });
    expect(view.configRows).toEqual([
      { id: "hostAgent", from: "Security Reviewer", to: "h2" },
      { id: "model", from: "m", to: "n" },
    ]);
  });

  it("judges a skill's text by its version", () => {
    const view = compareView({
      kind: "skill",
      none: "—",
      hostNames: new Map(),
      data: { base: skillSide(), head: skillSide({ run_id: "r2", skill_body: "edited" }), ...cases },
    });
    expect(view.sameText).toBe(true);
  });
});
