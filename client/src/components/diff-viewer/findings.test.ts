import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { findingKey, partitionFindings, topSeverity } from "./findings";

function finding(id: string, startLine: number, severity = "WARNING"): FindingRecord {
  return {
    id,
    review_id: "r1",
    severity,
    category: "bug",
    title: id,
    file: "src/a.ts",
    start_line: startLine,
    end_line: startLine,
    rationale: "because",
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
  } as FindingRecord;
}

describe("partitionFindings", () => {
  it("anchors a finding under RIGHT:<start_line> and sends an absent line to outside", () => {
    const inPatch = finding("f1", 12);
    const absent = finding("f2", 999);
    const { matched, outside } = partitionFindings([inPatch, absent], new Set(["RIGHT:12", "LEFT:12"]));

    expect(findingKey(inPatch)).toBe("RIGHT:12");
    expect(matched.get("RIGHT:12")).toEqual([inPatch]);
    expect(outside).toEqual([absent]);
  });

  it("does not anchor a finding to a deleted-side line", () => {
    const f = finding("f1", 5);
    const { matched, outside } = partitionFindings([f], new Set(["LEFT:5"]));
    expect(matched.size).toBe(0);
    expect(outside).toEqual([f]);
  });
});

describe("topSeverity", () => {
  it("ranks CRITICAL > WARNING > SUGGESTION and puts an unknown value last", () => {
    expect(topSeverity([finding("a", 1, "SUGGESTION"), finding("b", 2, "CRITICAL")])).toBe("CRITICAL");
    expect(topSeverity([finding("a", 1, "SUGGESTION"), finding("b", 2, "WARNING")])).toBe("WARNING");
    expect(topSeverity([finding("a", 1, "MYSTERY"), finding("b", 2, "SUGGESTION")])).toBe("SUGGESTION");
    expect(topSeverity([finding("a", 1, "MYSTERY")])).toBe("MYSTERY");
    expect(topSeverity([])).toBeUndefined();
  });
});
