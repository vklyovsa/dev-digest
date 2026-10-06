import type { GitHubClient } from '@devdigest/shared';
import type { IndexStatus, RepoIntel } from '../repo-intel/types.js';

export interface BlastPullRecord {
  id: string;
  repoId: string;
  number: number;
}

export interface BlastPullsReader {
  getById(workspaceId: string, prId: string): Promise<BlastPullRecord | undefined>;
  listFiles(prId: string): Promise<{ path: string }[]>;
}

export interface BlastRepoReader {
  getById(
    workspaceId: string,
    id: string,
  ): Promise<{ id: string; owner: string; name: string } | undefined>;
}

export type BlastRepoIntel = Pick<RepoIntel, 'getBlastRadius' | 'getIndexState'>;

export type BlastGitHubFactory = () => Promise<Pick<GitHubClient, 'listMergedPullsWithFiles'>>;

export interface BlastLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg: string): void;
}

export interface BlastDeps {
  readonly pulls: BlastPullsReader;
  readonly repos: BlastRepoReader;
  readonly repoIntel: BlastRepoIntel;
  readonly github: BlastGitHubFactory;
  readonly log: BlastLogger;
}

export interface BlastMapContext {
  indexStatus: IndexStatus;
  indexedSha: string;
  changedFilesCount: number;
  maxCallersPerSymbol: number;
}
