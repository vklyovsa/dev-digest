import { describe, it, expect } from "vitest";
import type { EvalCaseOutcome, EvalRun, EvalRunDetail } from "@devdigest/shared";
import { newlyFailingMustNotFlag, precisionDip } from "./helpers";

function run(over: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "r1",
    agent_id: "a1",
    agent_version: 7,
    skill_id: null,
    skill_version: null,
    status: "done",
    started_at: "2026-05-29T09:14:00Z",
    duration_ms: 1,
    recall: 0.8,
    precision: 0.91,
    citation_accuracy: 0.9,
    cases_total: 4,
    cases_passed: 3,
    cases_failed: 1,
    cases_errored: 0,
    findings_total: 1,
    findings_grounded: 1,
    cost_usd: null,
    provider: "p",
    model: "m",
    skills: [],
    case_ids: [],
    error: null,
    ...over,
  };
}

const outcome = (over: Partial<EvalCaseOutcome>): EvalCaseOutcome => ({
  case_id: "c1",
  case_name: "no-stripe-key",
  case_revision: 1,
  expectation_type: "must_not_flag",
  status: "pass",
  matched: 0,
  findings: [],
  error: null,
  ...over,
});

const detail = (results: EvalCaseOutcome[]): EvalRunDetail => ({ ...run(), results });

describe("precisionDip", () => {
  it("returns the size in points and the latest version when precision fell", () => {
    expect(precisionDip(run({ agent_version: 7, precision: 0.91 }), run({ precision: 0.93 }))).toEqual({
      points: 2,
      version: 7,
    });
  });

  it("returns null when precision is equal, higher, or missing on either side", () => {
    expect(precisionDip(run({ precision: 0.91 }), run({ precision: 0.91 }))).toBeNull();
    expect(precisionDip(run({ precision: 0.95 }), run({ precision: 0.91 }))).toBeNull();
    expect(precisionDip(run({ precision: null }), run({ precision: 0.91 }))).toBeNull();
    expect(precisionDip(run({ precision: 0.9 }), run({ precision: null }))).toBeNull();
    expect(precisionDip(null, run())).toBeNull();
    expect(precisionDip(run(), null)).toBeNull();
  });

  it("does not report a dip that rounds to zero points", () => {
    expect(precisionDip(run({ precision: 0.912 }), run({ precision: 0.914 }))).toBeNull();
  });
});

describe("newlyFailingMustNotFlag", () => {
  it("names the must_not_flag cases that fail now and passed before", () => {
    const latest = detail([
      outcome({ case_id: "c1", case_name: "no-stripe-key", status: "fail" }),
      outcome({ case_id: "c2", case_name: "no-todo", status: "fail" }),
      outcome({ case_id: "c3", case_name: "no-style", status: "pass" }),
      outcome({ case_id: "c4", case_name: "must-find-sql", expectation_type: "must_find", status: "fail" }),
    ]);
    const previous = detail([
      outcome({ case_id: "c1", status: "pass" }),
      outcome({ case_id: "c2", case_name: "no-todo", status: "fail" }),
      outcome({ case_id: "c3", case_name: "no-style", status: "pass" }),
      outcome({ case_id: "c4", case_name: "must-find-sql", expectation_type: "must_find", status: "pass" }),
    ]);

    expect(newlyFailingMustNotFlag(latest, previous)).toEqual(["no-stripe-key"]);
  });

  it("leaves out a case the previous run did not cover or errored on", () => {
    const latest = detail([outcome({ case_id: "c9", case_name: "new-case", status: "fail" })]);
    const previous = detail([outcome({ case_id: "c1", status: "error" })]);

    expect(newlyFailingMustNotFlag(latest, previous)).toEqual([]);
  });

  it("returns an empty list while either run is not loaded", () => {
    expect(newlyFailingMustNotFlag(undefined, detail([]))).toEqual([]);
    expect(newlyFailingMustNotFlag(detail([]), undefined)).toEqual([]);
  });
});
