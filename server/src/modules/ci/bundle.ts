import { MEMORY_PATH, RUNNER_PATH, SKILLS_DIR, WORKFLOW_PATH } from './constants.js';
import { memoryJsonl, toCiFile, uniqueSkillSlugs } from './helpers.js';
import { agentManifestPath, buildAgentManifest, renderAgentManifestYaml } from './manifest.js';
import type { BundleInput } from './types.js';
import { renderWorkflow } from './workflow.js';
import type { CiFile } from '@devdigest/shared';

export function buildFiles(input: BundleInput): CiFile[] {
  const slugs = uniqueSkillSlugs(input.skills);
  const manifest = buildAgentManifest(input.agent, slugs);
  return [
    toCiFile(agentManifestPath(input.agent.name), renderAgentManifestYaml(manifest), false),
    ...input.skills.map((s, i) => toCiFile(`${SKILLS_DIR}${slugs[i]}.md`, s.body, false)),
    toCiFile(MEMORY_PATH, memoryJsonl(input.memory), false),
    toCiFile(RUNNER_PATH, input.runner.contents, false),
    toCiFile(
      WORKFLOW_PATH,
      renderWorkflow({ triggers: input.triggers, postAs: input.postAs }),
      true,
    ),
  ];
}
