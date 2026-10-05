import type { RepoDocsReader } from '@devdigest/shared';
import type { SkipReason } from './constants.js';

/** One document a linked, enabled skill brings, with the skill it comes from. */
export interface LinkedSkillPath {
  skillId: string;
  skillName: string;
  path: string;
}

/** One agent that has `path` attached, directly or through a linked, enabled skill. */
export interface ContextUsageRow {
  path: string;
  agentId: string;
}

/** Repository port: the attachment lists of agents and skills. Reads come back ordered. */
export interface ContextStore {
  agentPaths(agentId: string): Promise<string[]>;
  skillPaths(skillId: string): Promise<string[]>;
  replaceAgentPaths(agentId: string, paths: readonly string[]): Promise<void>;
  replaceSkillPaths(skillId: string, paths: readonly string[]): Promise<void>;
  /** Enabled skills linked to the agent: in the agent's skill order, then by position. */
  linkedSkillPaths(agentId: string): Promise<LinkedSkillPath[]>;
  usage(workspaceId: string): Promise<ContextUsageRow[]>;
}

export interface ContextRepoReader {
  getById(
    workspaceId: string,
    id: string,
  ): Promise<{ id: string; clonePath: string | null } | undefined>;
}

export interface ContextOwnerReader {
  getById(workspaceId: string, id: string): Promise<{ id: string } | undefined>;
}

export interface ContextDeps {
  readonly store: ContextStore;
  readonly repos: ContextRepoReader;
  readonly agents: ContextOwnerReader;
  readonly skills: ContextOwnerReader;
  readonly docs: RepoDocsReader;
  readonly roots: readonly string[];
}

/** A document a run puts in its prompt, with the text read when the run starts. */
export interface RunContextDocument {
  path: string;
  text: string;
  tokens: number;
  source: 'agent' | 'skill';
  skillName: string | null;
}

export interface RunContextSkip {
  path: string;
  reason: SkipReason;
}

export interface RunContext {
  documents: RunContextDocument[];
  skipped: RunContextSkip[];
}
