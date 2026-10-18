"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "@devdigest/ui";
import { CiRunsTable } from "@/components/ci-runs/CiRunsTable";
import { useCiRuns, useCiSync } from "@/lib/hooks/ci";
import { s } from "./styles";

/** CI runs pulled from GitHub: syncs once on open, and again on Refresh. */
export function CiRunsView() {
  const t = useTranslations("ci");
  const runs = useCiRuns();
  const sync = useCiSync();
  const { mutate: runSync } = sync;
  const synced = React.useRef(false);

  React.useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    runSync();
  }, [runSync]);

  const rows = runs.data ?? [];
  const rejected = sync.data?.rejected ?? [];
  const errors = sync.data?.errors ?? [];
  const problems = rejected.length + errors.length;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.titles}>
          <h1 style={s.title}>{t("runs.title")}</h1>
          <p style={s.subtitle}>{t("runs.subtitle")}</p>
        </div>
        <Button icon="RefreshCw" loading={sync.isPending} disabled={sync.isPending} onClick={() => runSync()}>
          {sync.isPending ? t("runs.refreshing") : t("runs.refresh")}
        </Button>
      </div>

      {sync.error && (
        <div role="alert" style={s.failure}>
          <span>{t("runs.syncFailed")}</span>
          <span>{sync.error.message}</span>
        </div>
      )}

      {problems > 0 && (
        <div role="status" style={s.notice}>
          <span style={s.noticeTitle}>{t("runs.syncNotice", { count: problems })}</span>
          {rejected.map((r) => (
            <span key={`${r.run_url}:${r.reason}`} style={s.noticeItem}>
              {r.run_url} — {t(`runs.reasons.${r.reason}`)}
            </span>
          ))}
          {errors.map((e) => (
            <span key={`${e.repo}:${e.message}`} style={s.noticeItem}>
              {e.repo} — {e.message}
            </span>
          ))}
        </div>
      )}

      {runs.isLoading ? (
        <span role="status" style={s.muted}>
          {t("runs.loading")}
        </span>
      ) : runs.error ? (
        <div style={s.failure}>
          <span role="alert">
            {t("runs.loadError")}: {runs.error.message}
          </span>
          <Button size="sm" onClick={() => runs.refetch()}>
            {t("runs.errorRetry")}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
      ) : (
        <CiRunsTable runs={rows} />
      )}
    </div>
  );
}
