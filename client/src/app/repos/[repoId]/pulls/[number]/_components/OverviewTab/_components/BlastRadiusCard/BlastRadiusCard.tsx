"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Card, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useBlastRadius } from "@/lib/hooks/blast";
import { BlastGraph } from "./_components/BlastGraph";
import { BlastTree } from "./_components/BlastTree";
import { DegradedNotice } from "./_components/DegradedNotice";
import { PriorPrs } from "./_components/PriorPrs";
import { BLAST_VIEWS, STAT_ITEMS, type BlastView } from "./constants";
import { s, segmentFor } from "./styles";

interface BlastRadiusCardProps {
  prId: string;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
}

export function BlastRadiusCard({ prId, repoId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const format = useFormatter();
  const { data, isError, error, refetch } = useBlastRadius(prId);
  const [view, setView] = React.useState<BlastView>("tree");

  if (isError) {
    return (
      <Frame title={t("title")}>
        <div role="alert" style={s.error}>
          <span>{t("error.title")}</span>
          {error instanceof ApiError && <span>{error.message}</span>}
          <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => refetch()}>
            {t("error.retry")}
          </Button>
        </div>
      </Frame>
    );
  }

  if (!data) {
    return (
      <Frame title={t("title")}>
        <Skeleton height={16} width="60%" style={{ marginBottom: 12 }} />
        <Skeleton height={13} width="100%" style={{ marginBottom: 6 }} />
        <Skeleton height={13} width="85%" />
      </Frame>
    );
  }

  return (
    <Frame title={t("title")}>
      <div style={s.summaryRow}>
        <ul aria-label={t("stat.label")} style={s.summary}>
          {STAT_ITEMS.map(({ key, icon }) => {
            const StatIcon = Icon[icon];
            return (
              <li key={key} style={s.stat}>
                <StatIcon size={14} style={s.statIcon} />
                <span>
                  <b className="tnum" style={s.statValue}>
                    {format.number(data.totals[key])}
                  </b>{" "}
                  {t(`stat.${key}`, { count: data.totals[key] })}
                </span>
              </li>
            );
          })}
        </ul>

        <div role="group" aria-label={t("view.label")} style={s.segmented}>
          {BLAST_VIEWS.map((option) => (
            <Button
              key={option}
              kind="tertiary"
              size="sm"
              active={view === option}
              aria-pressed={view === option}
              style={segmentFor(view === option)}
              onClick={() => setView(option)}
            >
              {t(`view.${option}`)}
            </Button>
          ))}
        </div>
      </div>

      {data.degraded && data.changed_files_count > 0 && (
        <DegradedNotice reason={data.reason} repoId={repoId} prId={prId} />
      )}

      <BlastBody data={data} view={view} repoFullName={repoFullName} headSha={headSha} />

      <PriorPrs prId={prId} repoFullName={repoFullName} />
    </Frame>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <SectionLabel icon="Boxes">{title}</SectionLabel>
      <Card>{children}</Card>
    </section>
  );
}

interface BlastBodyProps {
  data: BlastRadiusResponse;
  view: BlastView;
  repoFullName: string | null;
  headSha: string;
}

function BlastBody({ data, view, repoFullName, headSha }: BlastBodyProps) {
  const t = useTranslations("blast");

  if (data.changed_files_count === 0) return <p style={s.muted}>{t("empty.noFiles")}</p>;
  if (data.changed_symbols.length === 0) return <p style={s.muted}>{t("empty.noSymbols")}</p>;
  if (data.downstream.length === 0) {
    return <p style={s.muted}>{t("noDownstream", { count: data.changed_symbols.length })}</p>;
  }
  if (view === "graph") return <BlastGraph data={data} />;
  return <BlastTree data={data} repoFullName={repoFullName} sha={data.indexed_sha ?? headSha} />;
}
