import { strToU8, zipSync } from 'fflate';
import { Verdict } from '@devdigest/shared';
import { RUNNER_PATH } from './constants.js';
import type { CiFile, CiInstallation, CiRun } from '@devdigest/shared';
import type { MemoryRecord, StoredCiRun, StoredInstallation } from './types.js';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function uniqueSkillSlugs(skills: readonly { name: string }[]): string[] {
  const seen = new Map<string, number>();
  return skills.map((s) => {
    const base = slugify(s.name) || 'skill';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

export function memoryJsonl(rows: readonly MemoryRecord[]): string {
  return rows
    .map((r) => JSON.stringify({ kind: r.kind, scope: r.scope, content: r.content }) + '\n')
    .join('');
}

export function toCiFile(path: string, contents: string, editable: boolean): CiFile {
  return { path, contents, editable, size_bytes: Buffer.byteLength(contents) };
}

export function toPreviewFiles(files: readonly CiFile[]): CiFile[] {
  return files.map((f) => (f.path === RUNNER_PATH ? { ...f, contents: '', editable: false } : f));
}

export function findSecretFile(files: readonly CiFile[], values: readonly string[]): string | null {
  for (const file of files) {
    if (values.some((v) => v.length >= 8 && file.contents.includes(v))) return file.path;
  }
  return null;
}

export function zipFiles(files: readonly CiFile[]): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.path] = strToU8(f.contents);
  return Buffer.from(zipSync(entries));
}

export function toInstallationDto(row: StoredInstallation): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
    latest_run_status: row.latestRunStatus,
    latest_run_at: row.latestRunAt ? row.latestRunAt.toISOString() : null,
    manifest_version: row.manifestVersion,
  };
}

export function toCiRunDto(row: StoredCiRun): CiRun {
  const verdict = Verdict.safeParse(row.verdict);
  return {
    id: row.id,
    ci_installation_id: row.installationId,
    pr_number: row.prNumber,
    ran_at: row.ranAt ? row.ranAt.toISOString() : null,
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    agent: row.agentName,
    duration_s: row.durationMs == null ? null : row.durationMs / 1000,
    repo: row.repo,
    agent_id: row.agentId,
    verdict: verdict.success ? verdict.data : null,
    critical: row.critical,
    warning: row.warning,
    suggestion: row.suggestion,
  };
}
