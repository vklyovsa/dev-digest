/** Pure helpers for multi-agent runs: finding grouping and run assembly. No I/O. */
import type { AgentColumn, ConflictTake, FindingGroup, FindingRecord, MultiAgentRun } from '@devdigest/shared';
import { SEVERITY_RANK } from './constants.js';
import type { ChildRun, RunHead } from './repository.js';

const rank = (severity: string): number => SEVERITY_RANK[severity] ?? 0;

interface Tagged {
  finding: FindingRecord;
  columnIndex: number;
}

function worse(a: Tagged, b: Tagged): boolean {
  const byRank = rank(a.finding.severity) - rank(b.finding.severity);
  if (byRank !== 0) return byRank > 0;
  if (a.finding.confidence !== b.finding.confidence) return a.finding.confidence > b.finding.confidence;
  return a.columnIndex < b.columnIndex;
}

/**
 * Group the findings of `done` columns: same file and overlapping inclusive
 * line ranges, directly or through other findings of the group.
 */
export function groupFindings(columns: AgentColumn[]): FindingGroup[] {
  const done = columns.filter((c) => c.status === 'done');
  const byFile = new Map<string, Tagged[]>();
  done.forEach((column, columnIndex) => {
    for (const finding of column.findings) {
      const list = byFile.get(finding.file) ?? [];
      list.push({ finding, columnIndex });
      byFile.set(finding.file, list);
    }
  });

  const groups: FindingGroup[] = [];
  for (const [file, items] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...items].sort(
      (a, b) => a.finding.start_line - b.finding.start_line || a.columnIndex - b.columnIndex,
    );
    let current: Tagged[] = [];
    let end = -Infinity;
    const flush = () => {
      if (current.length > 0) groups.push(buildGroup(file, current, done));
      current = [];
    };
    for (const item of sorted) {
      if (current.length > 0 && item.finding.start_line > end) {
        flush();
        end = -Infinity;
      }
      current.push(item);
      end = Math.max(end, item.finding.end_line);
    }
    flush();
  }
  return groups;
}

function buildGroup(file: string, members: Tagged[], done: AgentColumn[]): FindingGroup {
  const best = members.reduce((acc, m) => (worse(m, acc) ? m : acc));
  const takes: ConflictTake[] = done.map((column, columnIndex) => {
    const mine = members.filter((m) => m.columnIndex === columnIndex);
    if (mine.length === 0) {
      return {
        run_id: column.run_id,
        agent_id: column.agent_id,
        agent_name: column.agent_name,
        finding_ids: [],
        verdict: 'ignored',
        note: '',
      };
    }
    const top = mine.reduce((acc, m) => (rank(m.finding.severity) > rank(acc.finding.severity) ? m : acc));
    return {
      run_id: column.run_id,
      agent_id: column.agent_id,
      agent_name: column.agent_name,
      finding_ids: mine.map((m) => m.finding.id),
      verdict: top.finding.severity as ConflictTake['verdict'],
      note: top.finding.title,
    };
  });
  const flagged = takes.filter((t) => t.verdict !== 'ignored').map((t) => t.verdict);
  return {
    file,
    start_line: Math.min(...members.map((m) => m.finding.start_line)),
    end_line: Math.max(...members.map((m) => m.finding.end_line)),
    title: best.finding.title,
    conflict: takes.some((t) => t.verdict === 'ignored') || new Set(flagged).size > 1,
    takes,
  };
}

export interface ChildReview {
  run_id: string | null;
  verdict: string | null;
  summary: string | null;
  findings: FindingRecord[];
}

const STATUSES = ['running', 'done', 'failed', 'cancelled'] as const;

function toStatus(status: string | null): AgentColumn['status'] {
  return (STATUSES as readonly string[]).includes(status ?? '') ? (status as AgentColumn['status']) : 'running';
}

export function buildMultiAgentRun(head: RunHead, children: ChildRun[], reviews: ChildReview[]): MultiAgentRun {
  const reviewByRun = new Map<string, ChildReview>();
  for (const review of reviews) {
    if (review.run_id && !reviewByRun.has(review.run_id)) reviewByRun.set(review.run_id, review);
  }

  const columns: AgentColumn[] = [...children]
    .sort((a, b) => {
      if (a.agentName === null) return b.agentName === null ? 0 : 1;
      if (b.agentName === null) return -1;
      return a.agentName.localeCompare(b.agentName);
    })
    .map((child) => {
      const review = reviewByRun.get(child.runId);
      return {
        run_id: child.runId,
        agent_id: child.agentId,
        agent_name: child.agentName ?? '',
        provider: child.provider,
        model: child.model,
        status: toStatus(child.status),
        error: child.error,
        verdict: review?.verdict ?? null,
        score: child.score,
        summary: review?.summary ?? null,
        duration_ms: child.durationMs,
        cost_usd: child.costUsd,
        findings: review?.findings ?? [],
      };
    });

  const durations = children.map((c) => c.durationMs).filter((d): d is number => d !== null);
  const costs = children.map((c) => c.costUsd).filter((c): c is number => c !== null);

  return {
    id: head.id,
    pr_id: head.prId,
    pr_number: head.prNumber,
    pr_title: head.prTitle,
    ran_at: head.ranAt.toISOString(),
    agent_count: children.length,
    total_duration_ms: durations.length > 0 ? Math.max(...durations) : 0,
    total_cost_usd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    columns,
    groups: groupFindings(columns),
  };
}
