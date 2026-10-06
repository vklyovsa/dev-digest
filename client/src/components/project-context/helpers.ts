import { DOC_TYPE_COLORS, NEUTRAL_DOC_TYPE_COLORS } from "./constants";

/** Split a repository-relative path into the file name and its folder (with the trailing slash). */
export function splitDocPath(path: string): { name: string; folder: string } {
  const cut = path.lastIndexOf("/") + 1;
  return { name: path.slice(cut), folder: path.slice(0, cut) };
}

/** Case-insensitive substring match of the typed text against a document's whole path. */
export function matchesDocQuery(path: string, query: string): boolean {
  return path.toLowerCase().includes(query.toLowerCase());
}

/** The searched folders as an empty state names them: `specs/ · docs/ · insights/`. */
export function formatRoots(roots: readonly string[]): string {
  return roots.map((root) => `${root}/`).join(" · ");
}

/** `type` is a folder name from the repository, so it is looked up as own data, never as a property chain. */
export function docTypeColors(type: string): { color: string; bg: string } {
  return Object.hasOwn(DOC_TYPE_COLORS, type)
    ? DOC_TYPE_COLORS[type as keyof typeof DOC_TYPE_COLORS]
    : NEUTRAL_DOC_TYPE_COLORS;
}
