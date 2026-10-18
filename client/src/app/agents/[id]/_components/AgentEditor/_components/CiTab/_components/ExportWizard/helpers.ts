import type { CiFile } from "@devdigest/shared";
import { REPO_RE, RUNNER_PATH, WORKFLOW_PATH } from "./constants";

export const isRepoName = (repo: string) => REPO_RE.test(repo);

export const findWorkflow = (files: CiFile[]) => files.find((f) => f.path === WORKFLOW_PATH) ?? null;

/** The runner bundle is listed by path and size only. */
export const isRunner = (file: CiFile) => file.path === RUNNER_PATH;

export function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}
