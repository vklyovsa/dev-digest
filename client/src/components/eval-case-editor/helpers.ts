import type {
  EvalCase,
  EvalCaseCreateInput,
  EvalCaseDraft,
  EvalCaseTryInput,
  EvalCaseUpdateInput,
  EvalExpectationType,
} from "@devdigest/shared";
import type { PrFile } from "@/lib/types";

export type CaseFile = PrFile & { hasHunk: boolean };

const GIT_HEADER = "diff --git ";

/**
 * The files a pasted unified diff names, in order. Mirrors the server: a file starts at a
 * `diff --git ` line or, in a text without one, at a `--- ` line directly followed by `+++ `.
 */
export function splitDiffFiles(text: string): CaseFile[] {
  const lines = text.split("\n");
  const hasGit = lines.some((l) => l.startsWith(GIT_HEADER));
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (hasGit ? l.startsWith(GIT_HEADER) : l.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ")) {
      starts.push(i);
    }
  });

  const files: CaseFile[] = [];
  starts.forEach((from, n) => {
    const piece = lines.slice(from, starts[n + 1] ?? lines.length);
    const hunkAt = piece.findIndex((l) => l.startsWith("@@"));
    const header = hunkAt === -1 ? piece : piece.slice(0, hunkAt);
    const target = header.find((l) => l.startsWith("+++ "));
    if (target === undefined) return;
    const raw = target.slice(4).trim();
    if (raw === "/dev/null") return;
    const path = (raw.startsWith("b/") ? raw.slice(2) : raw).trim();
    if (path === "") return;

    const patchLines = hunkAt === -1 ? [] : piece.slice(hunkAt);
    while (patchLines.length > 0 && patchLines[patchLines.length - 1] === "") patchLines.pop();
    files.push({
      path,
      additions: patchLines.filter((l) => l.startsWith("+")).length,
      deletions: patchLines.filter((l) => l.startsWith("-")).length,
      patch: patchLines.join("\n"),
      hasHunk: hunkAt !== -1,
    });
  });
  return files;
}

export interface FormValues {
  name: string;
  type: EvalExpectationType;
  diff: string;
  prTitle: string;
  /** Null stays null until the field is typed in. */
  prBody: string | null;
  file: string;
  startLine: string;
  endLine: string;
  title: string;
  severity: string;
  category: string;
}

export function initialValues(evalCase: EvalCase | null): FormValues {
  if (!evalCase) {
    return {
      name: "",
      type: "must_find",
      diff: "",
      prTitle: "",
      prBody: null,
      file: "",
      startLine: "",
      endLine: "",
      title: "",
      severity: "",
      category: "",
    };
  }
  const { expected_output: e, input_meta: m } = evalCase;
  return {
    name: evalCase.name,
    type: evalCase.expectation_type,
    diff: evalCase.input_diff,
    prTitle: m.pr_title,
    prBody: m.pr_body,
    file: e.file,
    startLine: String(e.start_line),
    endLine: String(e.end_line),
    title: e.title,
    severity: e.severity,
    category: e.category,
  };
}

export function initialValuesFromDraft(draft: EvalCaseDraft): FormValues {
  const { expected_output: e, input_meta: m } = draft;
  return {
    name: draft.name,
    type: draft.expectation_type,
    diff: draft.input_diff,
    prTitle: m.pr_title,
    prBody: m.pr_body,
    file: e.file,
    startLine: String(e.start_line),
    endLine: String(e.end_line),
    title: e.title,
    severity: e.severity,
    category: e.category,
  };
}

export interface TryMeta {
  pr_number: number | null;
  pr_author: string | null;
}

/** What the form cannot edit but a try still sends: the draft's, else the stored case's, else none. */
export function tryMeta(evalCase: EvalCase | null, draft: EvalCaseDraft | null | undefined): TryMeta {
  const m = draft?.input_meta ?? evalCase?.input_meta;
  return { pr_number: m?.pr_number ?? null, pr_author: m?.pr_author ?? null };
}

/** Both numbers whole, the start at 1 or above and the end not before it. */
export function lineRange(start: string, end: string): { startLine: number; endLine: number } | null {
  if (!/^\d+$/.test(start.trim()) || !/^\d+$/.test(end.trim())) return null;
  const startLine = parseInt(start, 10);
  const endLine = parseInt(end, 10);
  if (startLine < 1 || endLine < startLine) return null;
  return { startLine, endLine };
}

export function canSave(values: FormValues): boolean {
  return (
    values.name.trim() !== "" &&
    values.diff.trim() !== "" &&
    values.file.trim() !== "" &&
    lineRange(values.startLine, values.endLine) !== null
  );
}

export function isDirty(values: FormValues, initial: FormValues): boolean {
  const keys = Object.keys(initial) as Array<keyof FormValues>;
  return keys.some((k) =>
    k === "prBody" ? (values.prBody ?? "") !== (initial.prBody ?? "") : values[k] !== initial[k],
  );
}

/** The file stays chosen while the new text still names it; a one-file text selects its file. */
export function fileAfterDiffChange(file: string, paths: readonly string[]): string {
  if (paths.includes(file)) return file;
  return paths.length === 1 ? paths[0]! : "";
}

function expectedOutput(values: FormValues): EvalCaseUpdateInput["expected_output"] {
  return {
    file: values.file,
    start_line: Number(values.startLine),
    end_line: Number(values.endLine),
    title: values.title,
    severity: values.severity as EvalCaseUpdateInput["expected_output"]["severity"],
    category: values.category as EvalCaseUpdateInput["expected_output"]["category"],
  };
}

export function toCreateBody(values: FormValues): EvalCaseCreateInput {
  const body = values.prBody ?? "";
  return {
    name: values.name,
    expectation_type: values.type,
    input_diff: values.diff,
    input_meta: { pr_title: values.prTitle, pr_body: body === "" ? null : body },
    expected_output: expectedOutput(values),
  };
}

/** An untouched Body sends the opened value, so null and "" never flip by themselves. */
export function toUpdateBody(values: FormValues, initial: FormValues): EvalCaseUpdateInput {
  const text = values.prBody ?? "";
  return {
    name: values.name,
    input_diff: values.diff,
    input_meta: {
      pr_title: values.prTitle,
      pr_body: text === (initial.prBody ?? "") ? initial.prBody : text,
    },
    expected_output: expectedOutput(values),
  };
}

export function toTryBody(values: FormValues, meta: TryMeta): EvalCaseTryInput {
  const body = values.prBody ?? "";
  return {
    expectation_type: values.type,
    input_diff: values.diff,
    input_meta: { ...meta, pr_title: values.prTitle, pr_body: body === "" ? null : body },
    expected_output: {
      file: values.file,
      start_line: Number(values.startLine),
      end_line: Number(values.endLine),
    },
  };
}
