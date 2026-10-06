import type { SpecFile } from "@devdigest/shared";

/** The `doc` value when it names a listed document, else the first document, else nothing. */
export function selectedPath(
  documents: readonly SpecFile[],
  docParam: string | null,
): string | null {
  if (docParam !== null && documents.some((doc) => doc.path === docParam)) return docParam;
  return documents[0]?.path ?? null;
}
