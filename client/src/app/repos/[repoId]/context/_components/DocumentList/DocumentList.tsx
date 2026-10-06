"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { DocPath, DocTypeBadge, formatRoots, matchesDocQuery } from "@/components/project-context";
import { s } from "./styles";

const SKELETON_ROWS = 6;

interface DocumentListProps {
  documents: SpecFile[];
  roots: string[];
  selected: string | null;
  isLoading: boolean;
  isError: boolean;
  refresh: { start: () => void; isRunning: boolean; ready: boolean };
  onRetry: () => void;
  onSelect: (path: string) => void;
}

export function DocumentList({
  documents,
  roots,
  selected,
  isLoading,
  isError,
  refresh,
  onRetry,
  onSelect,
}: DocumentListProps) {
  const t = useTranslations("context");
  const [query, setQuery] = React.useState("");
  const visible = documents.filter((doc) => matchesDocQuery(doc.path, query));

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div style={s.skeletons}>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <Skeleton key={i} height={34} />
        ))}
      </div>
    );
  } else if (isError) {
    body = <ErrorState title={t("page.loadError")} onRetry={onRetry} />;
  } else if (documents.length === 0) {
    body = (
      <EmptyState
        icon="Folder"
        title={t("page.emptyTitle")}
        body={t("page.emptyBody", { roots: formatRoots(roots) })}
      />
    );
  } else if (visible.length === 0) {
    body = <p style={s.noMatch}>{t("page.emptyTitle")}</p>;
  } else {
    body = (
      <ul style={s.list}>
        {visible.map((doc) => {
          const isSelected = doc.path === selected;
          return (
            <li key={doc.path}>
              <button
                type="button"
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onSelect(doc.path)}
                style={s.row(isSelected)}
              >
                <Icon.FileText size={15} style={s.rowIcon(isSelected)} />
                <span style={s.rowPath}>
                  <DocPath path={doc.path} />
                </span>
                <span style={s.rowBadge}>
                  <DocTypeBadge type={doc.type} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <aside style={s.panel}>
      <header style={s.head}>
        <div style={s.caption}>{t("page.caption")}</div>
        {roots.length > 0 && (
          <div className="mono" style={s.roots}>
            {formatRoots(roots)}
          </div>
        )}
        <div style={s.search}>
          <Icon.Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("page.search")}
            aria-label={t("page.search")}
            style={s.searchInput}
          />
        </div>
        <Button
          kind="ghost"
          size="sm"
          icon="RefreshCw"
          loading={refresh.isRunning}
          disabled={!refresh.ready}
          onClick={() => refresh.start()}
        >
          {refresh.isRunning ? t("page.refreshing") : t("page.refresh")}
        </Button>
      </header>
      <div style={s.scroll}>{body}</div>
      {!isLoading && !isError && (
        <footer style={s.footer}>{t("page.fileCount", { count: documents.length })}</footer>
      )}
    </aside>
  );
}
