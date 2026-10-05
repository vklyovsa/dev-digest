"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useContextFiles, useContextRefresh } from "@/lib/hooks/core";
import { selectedPath } from "../../helpers";
import { DocumentList } from "../DocumentList";
import { DocumentPane } from "../DocumentPane";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  const router = useRouter();
  const search = useSearchParams();
  const { repoId } = useParams<{ repoId: string }>();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data, isLoading, isError, refetch } = useContextFiles(repoId, !repoNotFound);
  const refresh = useContextRefresh(repoNotFound ? null : repoId);

  const crumb = [{ label: activeRepo?.full_name ?? repoId, mono: true }, { label: t("title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const documents = data?.documents ?? [];
  const selected = selectedPath(documents, search.get("doc"));
  const selectedDocument = documents.find((doc) => doc.path === selected) ?? null;

  const select = (path: string) => {
    const next = new URLSearchParams(search.toString());
    next.set("doc", path);
    router.push(`/repos/${repoId}/context?${next.toString()}`);
  };

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {refresh.failed && (
          <div role="alert" style={s.alert}>
            {t("page.refreshError")}
          </div>
        )}
        {refresh.timedOut && (
          <div role="alert" style={s.alert}>
            {t("page.refreshSlow")}
          </div>
        )}
        <div style={s.body}>
          <DocumentList
            documents={documents}
            roots={data?.roots ?? []}
            selected={selected}
            isLoading={isLoading}
            isError={isError}
            refresh={refresh}
            onRetry={() => refetch()}
            onSelect={select}
          />
          <DocumentPane repoId={repoId} doc={selectedDocument} />
        </div>
      </div>
    </AppShell>
  );
}
