"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { formatRoots } from "../helpers";
import { PreviewDialog } from "../PreviewDialog";
import type { AttachmentState } from "../useAttachments";
import { AttachmentRow, type RowActions } from "./AttachmentRow";
import { buildRows, move, toggle } from "./helpers";
import { s } from "./styles";

const SKELETON_ROWS = 5;

interface AttachmentEditorProps {
  state: AttachmentState;
  preview: "button" | "icon";
}

/** The filter box and the document rows shared by the agent's and the skill's Context tab. */
export function AttachmentEditor({ state, preview }: AttachmentEditorProps) {
  const t = useTranslations("context");
  const { repoId, repoState, documents, roots, paths, inherited, loading, failed, retry, commit } = state;
  const [filter, setFilter] = React.useState("");
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [previewing, setPreviewing] = React.useState<string | null>(null);

  const rows = buildRows(documents, paths, inherited, filter);

  const actions: RowActions = {
    toggle: (path) => commit(toggle(paths, path)),
    move: (path, by) => {
      const from = paths.indexOf(path);
      const next = move(paths, from, from + by);
      if (next !== paths) commit(next);
    },
    preview: setPreviewing,
    dragStart: setDragging,
    drop: (target) => {
      const from = dragging === null ? -1 : paths.indexOf(dragging);
      const to = paths.indexOf(target);
      setDragging(null);
      if (from < 0 || to < 0 || from === to) return;
      commit(move(paths, from, to));
    },
    dragEnd: () => setDragging(null),
  };

  let body: React.ReactNode;
  if (repoState === "none") {
    body = <p style={s.notice}>{t("attach.noRepo")}</p>;
  } else if (failed) {
    body = <ErrorState title={t("attach.loadError")} onRetry={retry} />;
  } else if (loading && documents.length === 0) {
    body = (
      <div style={s.skeletons} aria-busy="true">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <Skeleton key={i} height={44} />
        ))}
      </div>
    );
  } else if (documents.length === 0 && paths.length === 0 && inherited.length === 0) {
    body = <p style={s.notice}>{t("attach.empty", { roots: formatRoots(roots) })}</p>;
  } else if (rows.length === 0) {
    body = <p style={s.notice}>{t("page.emptyTitle")}</p>;
  } else {
    body = (
      <ul style={s.list} aria-busy={loading}>
        {rows.map((row) => (
          <AttachmentRow
            key={row.path}
            row={row}
            attachedCount={paths.length}
            disabled={loading}
            preview={preview}
            actions={actions}
          />
        ))}
      </ul>
    );
  }

  return (
    <div>
      <div style={s.filterRow}>
        <div style={s.filter}>
          <Icon.Search size={13} />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("attach.filter")}
            aria-label={t("attach.filter")}
            style={s.filterInput}
          />
        </div>
      </div>
      {body}
      {previewing !== null && repoId !== null && (
        <PreviewDialog repoId={repoId} path={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  );
}
