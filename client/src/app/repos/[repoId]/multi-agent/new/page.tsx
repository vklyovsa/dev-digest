"use client";

import React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { ConfigureRun } from "../_components/ConfigureRun";

/* Route: /repos/:repoId/multi-agent/new?pr=<pr id>&agents=<id,id> */
function NewRun() {
  const t = useTranslations("runs");
  const { repoId } = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const { activeRepo } = useActiveRepo();
  const agents = search.get("agents");
  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb"), href: `/repos/${repoId}/multi-agent` },
    { label: t("multiAgent.configureTitle") },
  ];

  return (
    <AppShell crumb={crumb}>
      <ConfigureRun
        repoId={repoId}
        preselect={{ pr: search.get("pr"), agents: agents ? agents.split(",") : undefined }}
      />
    </AppShell>
  );
}

export default function NewMultiAgentRunPage() {
  return (
    <React.Suspense>
      <NewRun />
    </React.Suspense>
  );
}
