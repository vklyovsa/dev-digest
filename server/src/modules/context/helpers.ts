import { approxTokens } from '../../platform/prompt-log.js';
import { MARKDOWN_EXTENSION } from './constants.js';
import type { ContextUsageRow, LinkedSkillPath } from './types.js';

export interface ClassifiedDocument {
  path: string;
  type: string;
}

/**
 * Keeps the Markdown paths that lie under a configured root folder (at any depth),
 * outside every dot-directory, and orders them by the root's position in `roots`
 * and then by path. `type` is the first folder of the path that is a root.
 */
export function classifyDocuments(
  paths: readonly string[],
  roots: readonly string[],
): ClassifiedDocument[] {
  const rank = new Map<string, number>();
  roots.forEach((root, index) => {
    if (!rank.has(root)) rank.set(root, index);
  });

  const found: { path: string; type: string; rank: number }[] = [];
  for (const path of paths) {
    if (!path.endsWith(MARKDOWN_EXTENSION)) continue;
    const folders = path.split('/').slice(0, -1);
    if (folders.some((folder) => folder.startsWith('.'))) continue;
    const type = folders.find((folder) => rank.has(folder));
    if (type === undefined) continue;
    found.push({ path, type, rank: rank.get(type) ?? 0 });
  }

  found.sort((a, b) => a.rank - b.rank || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return found.map(({ path, type }) => ({ path, type }));
}

export function docTokens(text: string): number {
  return approxTokens(text.length);
}

export type MergedAttachment =
  | { path: string; source: 'agent'; skillId: null; skillName: null }
  | { path: string; source: 'skill'; skillId: string; skillName: string };

/**
 * The agent's own paths first, in their order, then the skills' paths in the order
 * given (skill by skill). A path that occurs more than once stays at its first place.
 */
export function mergeAttachments(
  own: readonly string[],
  skills: readonly LinkedSkillPath[],
): MergedAttachment[] {
  const seen = new Set<string>();
  const merged: MergedAttachment[] = [];
  for (const path of own) {
    if (seen.has(path)) continue;
    seen.add(path);
    merged.push({ path, source: 'agent', skillId: null, skillName: null });
  }
  for (const { path, skillId, skillName } of skills) {
    if (seen.has(path)) continue;
    seen.add(path);
    merged.push({ path, source: 'skill', skillId, skillName });
  }
  return merged;
}

/** Distinct agents per path: an agent that has a path twice (directly and through a skill) counts once. */
export function countAgentsByPath(rows: readonly ContextUsageRow[]): Map<string, number> {
  const agentsByPath = new Map<string, Set<string>>();
  for (const { path, agentId } of rows) {
    const agents = agentsByPath.get(path) ?? new Set<string>();
    agents.add(agentId);
    agentsByPath.set(path, agents);
  }
  return new Map([...agentsByPath].map(([path, agents]) => [path, agents.size]));
}

/** `fn` over `items`, at most `size` at a time, results in the order of `items`. */
export async function mapInBatches<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    const batch = await Promise.all(items.slice(start, start + size).map(fn));
    for (const result of batch) results.push(result);
  }
  return results;
}
