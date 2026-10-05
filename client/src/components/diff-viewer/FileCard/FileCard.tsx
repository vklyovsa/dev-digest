/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { partitionFindings, fs, type DiffFindingsApi } from "../findings";
import type { DiffTarget } from "../target";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";
import { OutsideFindings } from "../OutsideFindings";
import type { FindingRecord } from "@devdigest/shared";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

function findingsForLine(ln: Line, matched: Map<string, FindingRecord[]>): FindingRecord[] {
  if (matched.size === 0) return [];
  return keysForLine(ln).flatMap((key) => matched.get(key) ?? []);
}

export function FileCard({
  file,
  commenting,
  findings,
  target,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  findings?: DiffFindingsApi;
  target?: DiffTarget;
}) {
  const t = useTranslations("shell");
  const isTarget = !!target;
  const autoOpen = (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES;
  const [toggled, setToggled] = React.useState<boolean | null>(null);
  const open = toggled ?? (isTarget || autoOpen);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  const targetLine = target?.line ?? null;
  const targetIndex =
    targetLine === null
      ? -1
      : lines.findIndex((ln) => (ln.kind === "add" || ln.kind === "ctx") && String(ln.newNo) === targetLine);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const targetRowRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isTarget) return;
    (targetRowRef.current ?? cardRef.current)?.scrollIntoView({ block: "center" });
  }, [isTarget, targetLine]);

  const renderedKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) keys.add(k);
    return keys;
  }, [lines]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, renderedKeys]);

  const allFindings = findings?.findings;
  const { matchedFindings, outsideFindings } = React.useMemo(() => {
    const fileFindings = (allFindings ?? []).filter((f) => f.file === file.path);
    const { matched, outside } = partitionFindings(fileFindings, renderedKeys);
    return { matchedFindings: matched, outsideFindings: outside };
  }, [allFindings, file.path, renderedKeys]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div
      ref={cardRef}
      aria-current={isTarget ? "true" : undefined}
      style={isTarget ? { ...s.fileCard, ...s.fileCardTarget } : s.fileCard}
    >
      <div onClick={() => setToggled(!open)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span style={fs.pathWrap}>
          <span className="mono" style={{ ...s.filePath, flex: "0 1 auto" }}>
            {file.path}
          </span>
          {findings?.flaggedPaths.has(file.path) && (
            <span role="img" aria-label={findings.labels.flagged} style={fs.dot} />
          )}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                lineFindings={findingsForLine(ln, matchedFindings)}
                findings={findings}
                rowRef={i === targetIndex ? targetRowRef : undefined}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
          {findings && findings.showCards && (
            <OutsideFindings findings={outsideFindings} api={findings} />
          )}
        </div>
      )}
    </div>
  );
}
