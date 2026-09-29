import { describe, it, expect } from "vitest";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import { currentFindings, diffTotals, flaggedPaths, hasReview, joinGroupFiles } from "./helpers";

function finding(id: string, line = 1): FindingRecord {
  return {
    id,
    review_id: "r",
    severity: "WARNING",
    category: "bug",
    title: id,
    file: "src/a.ts",
    start_line: line,
    end_line: line,
    rationale: "because",
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
  } as FindingRecord;
}

function review(
  id: string,
  agent: string | null,
  createdAt: string,
  findings: FindingRecord[],
  kind: "review" | "summary" = "review",
): ReviewRecord {
  return { id, agent_id: agent, kind, created_at: createdAt, findings } as ReviewRecord;
}

describe("currentFindings", () => {
  it("takes the newest review per agent, ignores summaries, counts null-agent runs separately", () => {
    const reviews = [
      review("r1", "A", "2026-06-01T10:00:00Z", [finding("a-old")]),
      review("r2", "A", "2026-06-01T12:00:00Z", [finding("a-new")]),
      review("r3", "B", "2026-06-01T09:00:00Z", [finding("b")]),
      review("r4", "C", "2026-06-01T13:00:00Z", [finding("summary-only")], "summary"),
      review("r5", null, "2026-06-01T10:00:00Z", [finding("n1")]),
      review("r6", null, "2026-06-01T11:00:00Z", [finding("n2")]),
    ];
    expect(
      currentFindings(reviews)
        .map((f) => f.id)
        .sort(),
    ).toEqual(["a-new", "b", "n1", "n2"]);
    expect(currentFindings(undefined)).toEqual([]);
  });

  it("keeps dismissed findings", () => {
    const dismissed = { ...finding("d"), dismissed_at: "2026-06-02T00:00:00Z" };
    expect(currentFindings([review("r1", "A", "2026-06-01T10:00:00Z", [dismissed])])).toEqual([dismissed]);
  });
});

describe("hasReview", () => {
  it("is false for no reviews or summaries only", () => {
    expect(hasReview([])).toBe(false);
    expect(hasReview(undefined)).toBe(false);
    expect(hasReview([review("r", "A", "2026-06-01T10:00:00Z", [], "summary")])).toBe(false);
    expect(hasReview([review("r", "A", "2026-06-01T10:00:00Z", [])])).toBe(true);
  });
});

const prFile = (path: string, additions = 1, deletions = 0): PrFile => ({
  path,
  additions,
  deletions,
  patch: `patch:${path}`,
});

describe("joinGroupFiles", () => {
  const smart: SmartDiff = {
    groups: [
      {
        role: "core",
        files: [
          { path: "src/b.ts", additions: 1, deletions: 0, finding_lines: [3] },
          { path: "src/a.ts", additions: 1, deletions: 0, finding_lines: [] },
        ],
      },
      { role: "docs", files: [{ path: "gone.md", additions: 4, deletions: 2, finding_lines: [] }] },
    ],
    split_suggestion: { too_big: false, total_lines: 8, proposed_splits: [] },
  };

  it("keeps smart-diff order, joins patches by path and counts flagged files", () => {
    const groups = joinGroupFiles(smart.groups, [prFile("src/a.ts"), prFile("src/b.ts")]);
    expect(groups.map((g) => g.role)).toEqual(["core", "docs"]);
    expect(groups[0]!.files.map((f) => f.path)).toEqual(["src/b.ts", "src/a.ts"]);
    expect(groups[0]!.files[0]!.patch).toBe("patch:src/b.ts");
    expect(groups[0]!.flaggedCount).toBe(1);
    expect(groups[1]!.files[0]).toEqual({ path: "gone.md", additions: 4, deletions: 2, patch: null });
  });

  it("appends a pr.files path missing from every group to core, creating it when absent", () => {
    const withOrphan = joinGroupFiles(smart.groups, [prFile("src/a.ts"), prFile("src/b.ts"), prFile("src/new.ts")]);
    expect(withOrphan[0]!.files.map((f) => f.path)).toEqual(["src/b.ts", "src/a.ts", "src/new.ts"]);

    const onlyDocs = joinGroupFiles([smart.groups[1]!], [prFile("gone.md"), prFile("src/new.ts")]);
    expect(onlyDocs.map((g) => g.role)).toEqual(["core", "docs"]);
    expect(onlyDocs[0]!.files.map((f) => f.path)).toEqual(["src/new.ts"]);
  });
});

describe("flaggedPaths and diffTotals", () => {
  it("lists only paths with finding lines and sums the totals", () => {
    const smart: SmartDiff = {
      groups: [
        {
          role: "core",
          files: [
            { path: "a", additions: 1, deletions: 0, finding_lines: [2] },
            { path: "b", additions: 1, deletions: 0, finding_lines: [] },
          ],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
    };
    expect([...flaggedPaths(smart)]).toEqual(["a"]);
    expect(flaggedPaths(undefined).size).toBe(0);
    expect(diffTotals([prFile("a", 3, 1), prFile("b", 4, 2)])).toEqual({ files: 2, additions: 7, deletions: 3 });
  });
});
