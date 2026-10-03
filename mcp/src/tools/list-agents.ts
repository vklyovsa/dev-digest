import { AGENTS_LIMIT, CLIP, MAX_RESULT_CHARS } from '../constants.js';
import type { AgentInfo, DevDigestApi } from '../ports.js';
import { clip, compareText, shrinkToFit } from '../text.js';

export interface AgentBrief {
  id: string;
  name: string;
  enabled: boolean;
  model: string;
  description: string;
}

export interface ListAgentsResult {
  agents: AgentBrief[];
  total: number;
  truncated?: true;
  next?: string;
}

const byName = (a: AgentInfo, b: AgentInfo): number =>
  compareText(a.name.toLowerCase(), b.name.toLowerCase()) ||
  compareText(a.name, b.name) ||
  compareText(a.id, b.id);

const toBrief = (agent: AgentInfo): AgentBrief => ({
  id: agent.id,
  name: clip(agent.name, CLIP.title),
  enabled: agent.enabled,
  model: clip(agent.model, CLIP.title),
  description: clip(agent.description, CLIP.description),
});

export async function listAgents(api: DevDigestApi, signal?: AbortSignal): Promise<ListAgentsResult> {
  const sorted = [...(await api.listAgents(signal))].sort(byName);
  const wanted = Math.min(AGENTS_LIMIT, sorted.length);

  const { value } = shrinkToFit<ListAgentsResult>(
    wanted,
    (count) => ({
      agents: sorted.slice(0, count).map(toBrief),
      total: sorted.length,
      ...(count < sorted.length
        ? {
            truncated: true as const,
            next: `Showing ${count} of ${sorted.length} agents, sorted by name. The others are not listed; an exact agent name also works wherever an id is accepted.`,
          }
        : {}),
    }),
    MAX_RESULT_CHARS,
  );
  return value;
}
