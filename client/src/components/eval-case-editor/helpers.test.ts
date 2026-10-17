import { describe, it, expect } from "vitest";
import type { EvalCase, EvalCaseDraft } from "@devdigest/shared";
import {
  canSave,
  fileAfterDiffChange,
  initialValues,
  initialValuesFromDraft,
  isDirty,
  lineRange,
  splitDiffFiles,
  toCreateBody,
  toTryBody,
  toUpdateBody,
  tryMeta,
} from "./helpers";

const GIT_TWO = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,4 @@",
  " one",
  "+two",
  " three",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
  " same",
].join("\n");

const PLAIN_TWO = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,4 @@",
  " one",
  "+two",
  " three",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
  " same",
].join("\n");

function makeCase(over: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "c1",
    owner_kind: "agent",
    owner_id: "a1",
    name: "leak",
    expectation_type: "must_find",
    expected_output: { file: "src/a.ts", start_line: 11, end_line: 11, severity: "WARNING", category: "bug", title: "T" },
    input_diff: PLAIN_TWO,
    input_files: ["src/a.ts", "src/b.ts"],
    input_meta: { pr_number: 4, pr_title: "Title", pr_author: "x", pr_body: null },
    source_finding_id: null,
    notes: null,
    revision: 1,
    created_at: "2026-10-12T10:00:00Z",
    last_result: null,
    ...over,
  };
}

describe("splitDiffFiles", () => {
  it("gives the same two paths in order for the git form and the plain form", () => {
    expect(splitDiffFiles(GIT_TWO).map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(splitDiffFiles(PLAIN_TWO).map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("keeps each file's patch from its hunk header and counts its lines", () => {
    const [a, b] = splitDiffFiles(GIT_TWO);
    expect(a!.patch!.startsWith("@@ -10,3 +10,4 @@")).toBe(true);
    expect(a).toMatchObject({ additions: 1, deletions: 0, hasHunk: true });
    expect(b).toMatchObject({ additions: 1, deletions: 1, hasHunk: true });
  });

  it("finds no file in prose or in a headerless hunk", () => {
    expect(splitDiffFiles("just some words\nand more")).toEqual([]);
    expect(splitDiffFiles("@@ -1,2 +1,2 @@\n-a\n+b")).toEqual([]);
  });

  it("skips a deleted file and marks a file without a hunk", () => {
    expect(splitDiffFiles("--- a/x.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x")).toEqual([]);
    expect(splitDiffFiles("--- a/x.ts\n+++ b/x.ts")[0]).toMatchObject({ path: "x.ts", hasHunk: false });
  });
});

describe("lineRange", () => {
  it("accepts a range from 1 up and refuses the rest", () => {
    expect(lineRange("0", "3")).toBeNull();
    expect(lineRange("3", "2")).toBeNull();
    expect(lineRange("", "2")).toBeNull();
    expect(lineRange("1.5", "2")).toBeNull();
    expect(lineRange("12", "13")).toEqual({ startLine: 12, endLine: 13 });
  });
});

describe("fileAfterDiffChange", () => {
  it("keeps a file the text still names", () => {
    expect(fileAfterDiffChange("a.ts", ["a.ts", "b.ts"])).toBe("a.ts");
  });
  it("selects the only file of a one-file text", () => {
    expect(fileAfterDiffChange("", ["a.ts"])).toBe("a.ts");
  });
  it("clears the choice when a two-file text no longer names it, e.g. a renamed path", () => {
    expect(fileAfterDiffChange("a.ts", ["renamed.ts", "b.ts"])).toBe("");
  });
});

describe("form values", () => {
  it("starts a new case empty with must_find", () => {
    const v = initialValues(null);
    expect(v).toMatchObject({ name: "", diff: "", type: "must_find", file: "" });
    expect(canSave(v)).toBe(false);
  });

  it("can save only with name, diff, file and a valid range", () => {
    const ok = initialValues(makeCase());
    expect(canSave(ok)).toBe(true);
    expect(canSave({ ...ok, name: "  " })).toBe(false);
    expect(canSave({ ...ok, diff: "" })).toBe(false);
    expect(canSave({ ...ok, file: "" })).toBe(false);
    expect(canSave({ ...ok, endLine: "10" })).toBe(false);
  });

  it("is dirty only after a change, and an emptied null body is not one", () => {
    const initial = initialValues(makeCase());
    expect(isDirty(initial, initial)).toBe(false);
    expect(isDirty({ ...initial, prBody: "" }, initial)).toBe(false);
    expect(isDirty({ ...initial, title: "other" }, initial)).toBe(true);
  });
});

describe("request bodies", () => {
  it("builds a create body with a null body for an empty text", () => {
    const body = toCreateBody({ ...initialValues(makeCase()), type: "must_not_flag", prBody: "" });
    expect(body).toMatchObject({
      name: "leak",
      expectation_type: "must_not_flag",
      input_meta: { pr_title: "Title", pr_body: null },
      expected_output: { file: "src/a.ts", start_line: 11, end_line: 11, severity: "WARNING" },
    });
  });

  it("keeps a null body for an untouched field and sends typed text", () => {
    const initial = initialValues(makeCase());
    expect(toUpdateBody(initial, initial).input_meta.pr_body).toBeNull();
    expect(toUpdateBody({ ...initial, prBody: "" }, initial).input_meta.pr_body).toBeNull();
    expect(toUpdateBody({ ...initial, prBody: "hi" }, initial).input_meta.pr_body).toBe("hi");
  });
});

const DRAFT: EvalCaseDraft = {
  expectation_type: "must_not_flag",
  name: "from-finding",
  input_diff: "--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,2 @@\n k\n+n",
  input_meta: { pr_number: 9, pr_title: "T", pr_author: "ann", pr_body: null },
  expected_output: { file: "x.ts", start_line: 2, end_line: 2, severity: "WARNING", category: "bug", title: "Odd" },
  problem: null,
};

describe("initialValuesFromDraft", () => {
  it("maps every draft field onto the form", () => {
    expect(initialValuesFromDraft(DRAFT)).toEqual({
      name: "from-finding",
      type: "must_not_flag",
      diff: DRAFT.input_diff,
      prTitle: "T",
      prBody: null,
      file: "x.ts",
      startLine: "2",
      endLine: "2",
      title: "Odd",
      severity: "WARNING",
      category: "bug",
    });
  });
});

describe("tryMeta", () => {
  it("prefers the draft, then the stored case, then nulls", () => {
    const stored = { input_meta: { pr_number: 3, pr_title: "", pr_author: "bob", pr_body: null } } as EvalCase;
    expect(tryMeta(stored, DRAFT)).toEqual({ pr_number: 9, pr_author: "ann" });
    expect(tryMeta(stored, null)).toEqual({ pr_number: 3, pr_author: "bob" });
    expect(tryMeta(null, undefined)).toEqual({ pr_number: null, pr_author: null });
  });
});

describe("toTryBody", () => {
  it("sends only file and lines of the expectation, and the meta it was given", () => {
    const v = initialValuesFromDraft(DRAFT);
    expect(toTryBody({ ...v, prTitle: "New" }, { pr_number: 9, pr_author: "ann" })).toEqual({
      expectation_type: "must_not_flag",
      input_diff: DRAFT.input_diff,
      input_meta: { pr_number: 9, pr_author: "ann", pr_title: "New", pr_body: null },
      expected_output: { file: "x.ts", start_line: 2, end_line: 2 },
    });
  });

  it("turns an empty body into null and keeps a typed one", () => {
    const v = initialValuesFromDraft(DRAFT);
    const meta = { pr_number: null, pr_author: null };
    expect(toTryBody({ ...v, prBody: "" }, meta).input_meta.pr_body).toBeNull();
    expect(toTryBody({ ...v, prBody: "hi" }, meta).input_meta.pr_body).toBe("hi");
  });

  it("does not carry the case name, so a rename leaves the body unchanged", () => {
    const v = initialValuesFromDraft(DRAFT);
    const meta = { pr_number: null, pr_author: null };
    expect(toTryBody({ ...v, name: "other" }, meta)).toEqual(toTryBody(v, meta));
  });
});
