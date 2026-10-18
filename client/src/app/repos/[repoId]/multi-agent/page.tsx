"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useLatestMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useActiveRepo } from "@/lib/repo-context";
import { ConfigureRun } from "./_components/ConfigureRun";
import { MultiAgentResults } from "./_components/MultiAgentResults";

/* Route: /repos/:repoId/multi-agent — the newest multi-agent run of the repo,
   or the Configure run screen when there is none. */
function Landing() {
  const t = useTranslations("runs");
  const { repoId } = useParams<{ repoId: string }>();
  const { activeRepo } = useActiveRepo();
  const { data, isLoading } = useLatestMultiAgentRun(repoId);
  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb") },
  ];

  return (
    <AppShell crumb={crumb}>
      {isLoading ? (
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={200} />
        </div>
      ) : data?.run ? (
        <MultiAgentResults run={data.run} repoId={repoId} />
      ) : (
        <ConfigureRun repoId={repoId} />
      )}
    </AppShell>
  );
}

export default function MultiAgentPage() {
  return (
    <React.Suspense>
      <Landing />
    </React.Suspense>
  );
}
