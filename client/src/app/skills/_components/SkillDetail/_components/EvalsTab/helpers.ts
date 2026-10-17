import type { Agent, EvalRun } from "@devdigest/shared";

/** The agents that link the skill, in link order, then the rest in list order. */
export function orderHosts(agents: Agent[], linkedIds: readonly string[]): Agent[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const linked = linkedIds.flatMap((id) => byId.get(id) ?? []);
  const linkedSet = new Set(linked.map((a) => a.id));
  return [...linked, ...agents.filter((a) => !linkedSet.has(a.id))];
}

/** The host a skill's run used last, else the first linked agent, else the first agent. */
export function defaultHostId(
  runs: readonly EvalRun[] | undefined,
  hosts: readonly Agent[],
  linkedIds: readonly string[],
): string | null {
  const newest = runs?.[0]?.agent_id;
  if (newest && hosts.some((a) => a.id === newest)) return newest;
  const linked = linkedIds.find((id) => hosts.some((a) => a.id === id));
  return linked ?? hosts[0]?.id ?? null;
}
