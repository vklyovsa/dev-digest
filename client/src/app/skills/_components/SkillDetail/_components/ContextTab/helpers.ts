export interface RootGroup {
  root: string | null;
  paths: string[];
}

function rootOf(path: string, roots: readonly string[]): string | null {
  return path.split("/").slice(0, -1).find((folder) => roots.includes(folder)) ?? null;
}

/**
 * Attached paths grouped by the root folder they lie under: groups in the order of `roots`,
 * paths in attachment order, and a path under none of the roots last, with `root: null`.
 */
export function groupByRoot(paths: readonly string[], roots: readonly string[]): RootGroup[] {
  const byRoot = new Map<string | null, string[]>();
  for (const path of paths) {
    const root = rootOf(path, roots);
    byRoot.set(root, [...(byRoot.get(root) ?? []), path]);
  }
  return [...new Set(roots), null].flatMap((root) => {
    const grouped = byRoot.get(root);
    return grouped ? [{ root, paths: grouped }] : [];
  });
}
