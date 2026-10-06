import { CLIP, HINT_LIST_MAX } from './constants.js';
import { ToolError } from './errors.js';
import type { AgentInfo, PullInfo, RepoInfo } from './ports.js';
import { clip, joinCapped } from './text.js';

const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function resolveAgent(agents: readonly AgentInfo[], value: string): AgentInfo {
  const wanted = value.trim();
  const byId = agents.find((agent) => agent.id === wanted);
  if (byId) return byId;

  const lower = wanted.toLowerCase();
  const byName = agents.filter((agent) => agent.name.trim().toLowerCase() === lower);
  const [only] = byName;
  if (byName.length === 1 && only) return only;

  const shown = clip(value, CLIP.title);
  if (byName.length === 0) {
    throw new ToolError(`Agent "${shown}" not found. Call list_agents and pass one of its ids.`);
  }
  const options = byName.map((agent) => `${agent.id} (${clip(agent.model, CLIP.title)})`);
  throw new ToolError(
    `Agent name "${shown}" matches ${byName.length} agents. Pass an id instead: ${joinCapped(options, HINT_LIST_MAX)}.`,
  );
}

export function resolveRepo(repos: readonly RepoInfo[], value: string): RepoInfo {
  const wanted = value.trim();
  const shown = clip(value, CLIP.title);
  if (!REPO_SHAPE.test(wanted)) {
    throw new ToolError(`repo must look like "owner/name" (got "${shown}").`);
  }

  const lower = wanted.toLowerCase();
  const found =
    repos.find((repo) => repo.fullName === wanted) ??
    repos.find((repo) => repo.fullName.toLowerCase() === lower);
  if (found) return found;

  if (repos.length === 0) {
    throw new ToolError(
      `Repository "${shown}" is not in DevDigest, and no repository is imported yet. Add it in the DevDigest UI first.`,
    );
  }
  const known = joinCapped(
    repos.map((repo) => clip(repo.fullName, CLIP.title)),
    HINT_LIST_MAX,
  );
  throw new ToolError(
    `Repository "${shown}" is not in DevDigest. Known repositories: ${known}. Use one of these exactly, or add the repository in the DevDigest UI first.`,
  );
}

export function resolvePull(
  pulls: readonly PullInfo[],
  repo: string,
  number: number,
): PullInfo & { id: string } {
  for (const pull of pulls) {
    if (pull.number === number && pull.id !== null) return { ...pull, id: pull.id };
  }

  const known = pulls
    .filter((pull) => pull.id !== null)
    .map((pull) => pull.number)
    .sort((a, b) => b - a)
    .map((n) => `#${n}`);
  const knowledge =
    known.length === 0
      ? 'DevDigest has no PRs for this repository yet.'
      : `DevDigest knows PRs: ${joinCapped(known, HINT_LIST_MAX)}.`;
  throw new ToolError(
    `PR #${number} not found in ${clip(repo, CLIP.title)}. ${knowledge} Check the number (gh pr list); only PRs imported into DevDigest can be reviewed, and importing needs a GitHub token in Settings.`,
  );
}
