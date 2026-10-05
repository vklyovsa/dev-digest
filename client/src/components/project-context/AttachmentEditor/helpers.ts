import type { ContextInheritedDoc, SpecFile } from "@devdigest/shared";
import { matchesDocQuery } from "../helpers";

export interface AttachmentRowData {
  path: string;
  source: "attached" | "inherited" | "available";
  /** The document's type; `null` when the path is not in the repository's document list. */
  type: string | null;
  missing: boolean;
  /** Name of the skill that brings an inherited document. */
  skillName: string | null;
  /** Position in the owner's attachment list; -1 for a row that is not attached. */
  index: number;
}

/** Move an item inside an array, returning a new array; an out-of-range or no-op move returns the same one. */
export function move<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Attach (append at the end) or detach a path, keeping the order of the rest. */
export function toggle(paths: string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((p) => p !== path) : [...paths, path];
}

/**
 * The owner's own attached documents in attachment order, then the inherited ones, then
 * every other document in the order the API returned. A path the list does not know still
 * gets its row, marked missing, so it can be detached. The filter applies to every row.
 */
export function buildRows(
  documents: readonly SpecFile[],
  paths: readonly string[],
  inherited: readonly ContextInheritedDoc[],
  filter: string,
): AttachmentRowData[] {
  const byPath = new Map(documents.map((doc) => [doc.path, doc]));
  const seen = new Set<string>();
  const rows: AttachmentRowData[] = [];

  const add = (
    path: string,
    source: AttachmentRowData["source"],
    skillName: string | null,
    index: number,
  ) => {
    if (seen.has(path)) return;
    seen.add(path);
    const doc = byPath.get(path);
    rows.push({ path, source, type: doc?.type ?? null, missing: !doc, skillName, index });
  };

  paths.forEach((path, index) => add(path, "attached", null, index));
  inherited.forEach((item) => add(item.path, "inherited", item.skill_name, -1));
  documents.forEach((doc) => add(doc.path, "available", null, -1));

  return rows.filter((row) => matchesDocQuery(row.path, filter));
}

/** Tokens of every attached and inherited document that is in the list; a path counts once. */
export function sumTokens(
  documents: readonly SpecFile[],
  paths: readonly string[],
  inherited: readonly ContextInheritedDoc[],
): number {
  const tokens = new Map(documents.map((doc) => [doc.path, doc.tokens]));
  const counted = new Set<string>();
  let sum = 0;
  for (const path of [...paths, ...inherited.map((item) => item.path)]) {
    if (counted.has(path)) continue;
    counted.add(path);
    sum += tokens.get(path) ?? 0;
  }
  return sum;
}
