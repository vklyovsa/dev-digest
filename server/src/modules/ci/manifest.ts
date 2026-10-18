import { stringify } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { AGENTS_DIR } from './constants.js';
import { slugify } from './helpers.js';
import type { CiAgentRecord } from './types.js';

export function buildAgentManifest(agent: CiAgentRecord, skillSlugs: string[]): AgentManifest {
  const result = AgentManifest.safeParse({
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: skillSlugs,
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
    version: agent.version,
  });
  if (!result.success) {
    throw new ValidationError(`Generated agent manifest failed validation: ${result.error.message}`);
  }
  return result.data;
}

export function renderAgentManifestYaml(manifest: AgentManifest): string {
  return stringify(manifest);
}

export function agentManifestPath(agentName: string): string {
  return `${AGENTS_DIR}${slugify(agentName) || 'agent'}.yaml`;
}
