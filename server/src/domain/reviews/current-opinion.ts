export interface ReviewIdentity {
  id: string;
  agentId: string | null;
  kind: string;
  createdAt: Date;
  prId?: string;
}

/** Newest `review` run per agent, newest first. A run with no agent keys on itself. */
export function newestPerAgent<T>(items: readonly T[], identify: (item: T) => ReviewIdentity): T[] {
  const newestFirst = items
    .filter((item) => identify(item).kind === 'review')
    .sort((a, b) => {
      const [x, y] = [identify(a), identify(b)];
      return y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0);
    });

  const seen = new Set<string>();
  return newestFirst.filter((item) => {
    const r = identify(item);
    const key = `${r.prId ?? ''}:${r.agentId ?? r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
