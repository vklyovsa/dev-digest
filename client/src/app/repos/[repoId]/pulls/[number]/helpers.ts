import type { FindingRecord, ReviewRecord } from "@devdigest/shared";

/** Every finding across a PR's review runs; reviews arrive newest-run-first. */
export function collectFindings(reviews: ReviewRecord[] | undefined): FindingRecord[] {
  return (reviews ?? []).flatMap((r) => r.findings);
}

/** The subset flagged as a lethal-trifecta prompt-injection risk. */
export function lethalTrifectaFindings(findings: FindingRecord[]): FindingRecord[] {
  return findings.filter((f) => f.kind === "lethal_trifecta");
}

export function diffTargetHref({
  repoId,
  number,
  file,
  line,
}: {
  repoId: string;
  number: string | number;
  file: string;
  line?: number;
}): string {
  const query = new URLSearchParams({ tab: "diff", file });
  if (line !== undefined) query.set("line", String(line));
  return `/repos/${repoId}/pulls/${number}?${query.toString()}`;
}

/** Raw URL text — never parsed or trusted. */
export function readDiffTarget(search: { get(name: string): string | null }): {
  file: string | null;
  line: string | null;
} {
  return { file: search.get("file"), line: search.get("line") };
}

export function tabQuery(search: { toString(): string }, tab: string): string {
  const params = new URLSearchParams(search.toString());
  params.set("tab", tab);
  params.delete("file");
  params.delete("line");
  return `?${params.toString()}`;
}
