"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useActiveRepo } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { MultiAgentResults } from "../_components/MultiAgentResults";

/* Route: /repos/:repoId/multi-agent/:runId */
function RunResults() {
  const t = useTranslations("runs");
  const { repoId, runId } = useParams<{ repoId: string; runId: string }>();
  const { activeRepo } = useActiveRepo();
  const { data: run, isLoading, isError, error, refetch } = useMultiAgentRun(runId);
  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb"), href: `/repos/${repoId}/multi-agent` },
    ...(run?.pr_number != null ? [{ label: `#${run.pr_number}`, mono: true }] : []),
  ];

  return (
    <AppShell crumb={crumb}>
      {isLoading ? (
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={200} />
        </div>
      ) : isError || !run ? (
        <ErrorState
          fullScreen
          title={t("multiAgent.loadFailed")}
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : (
        <MultiAgentResults run={run} repoId={repoId} />
      )}
    </AppShell>
  );
}

export default function MultiAgentRunPage() {
  return (
    <React.Suspense>
      <RunResults />
    </React.Suspense>
  );
}
