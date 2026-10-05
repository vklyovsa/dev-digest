"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Card, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { PrBriefRecord } from "@devdigest/shared";
import { formatUsd } from "@/components/run-cost";
import { ApiError } from "@/lib/api";
import { useGenerateBrief, usePrBrief } from "@/lib/hooks/brief";
import { usePrReviews } from "@/lib/hooks/reviews";
import { VerdictBanner } from "../../../VerdictBanner";
import { blockerCount, newestReviewWithVerdict } from "./helpers";
import { s } from "./styles";

type Generation = ReturnType<typeof useGenerateBrief>;

export function PrBriefSummary({ prId }: { prId: string }) {
  const t = useTranslations("brief");
  const brief = usePrBrief(prId);
  const generate = useGenerateBrief(prId);
  const stored = brief.data;

  return (
    <section aria-label={t("title")}>
      <SectionLabel icon="FileText">{t("title")}</SectionLabel>

      {generate.error && (
        <div role="alert" style={s.error}>
          {t("generateFailed", {
            message: generate.error instanceof ApiError ? generate.error.message : t("requestFailed"),
          })}
        </div>
      )}

      {!stored && brief.isError && (
        <div role="alert" style={s.loadError}>
          <span>{t("loadFailed")}</span>
          <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => brief.refetch()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {!stored && !brief.isError && (
        <Card>
          <div role="status" aria-label={t("loading")} style={s.skeletonStack}>
            <Skeleton height={16} width="60%" />
            <Skeleton height={13} width="100%" />
            <Skeleton height={13} width="85%" />
          </div>
        </Card>
      )}

      {stored && stored.brief === null && <NoBrief generate={generate} />}
      {stored && stored.brief !== null && <StoredBrief prId={prId} brief={stored.brief} generate={generate} />}
    </section>
  );
}

function NoBrief({ generate }: { generate: Generation }) {
  const t = useTranslations("brief");
  return (
    <Card style={s.emptyCard}>
      <div style={s.emptyText}>{t("unavailable")}</div>
      <div style={s.emptyHint}>{t("unavailableHint")}</div>
      <Button kind="primary" size="sm" icon="Sparkles" loading={generate.isPending} onClick={() => generate.mutate()}>
        {t("generate")}
      </Button>
      {generate.isPending && (
        <div role="status" aria-label={t("generating")} style={s.skeletonStack}>
          <Skeleton height={16} width="60%" />
          <Skeleton height={13} width="100%" />
          <Skeleton height={13} width="85%" />
        </div>
      )}
    </Card>
  );
}

function StoredBrief({ prId, brief, generate }: { prId: string; brief: PrBriefRecord; generate: Generation }) {
  const t = useTranslations("brief");
  const format = useFormatter();
  const reviews = usePrReviews(prId);
  const review = newestReviewWithVerdict(reviews.data);

  const missingFacts: string[] = [];
  if (brief.intent === null) missingFacts.push(t("block.intent"));
  if (brief.blast === null) missingFacts.push(t("block.blast"));

  return (
    <>
      {review ? (
        <VerdictBanner
          verdict={review.verdict}
          summary={brief.summary}
          score={review.score}
          findingsCount={review.findings.length}
          blockers={blockerCount(review.findings)}
          agentName={review.agent_name}
        />
      ) : (
        <Card>
          <p style={s.summary}>{brief.summary}</p>
        </Card>
      )}

      <div style={s.details}>
        <div style={s.controls}>
          <Button kind="ghost" size="sm" icon="RefreshCw" loading={generate.isPending} onClick={() => generate.mutate()}>
            {t("refresh")}
          </Button>
          <div style={s.meta}>
            <span className="mono">
              {t("meta", { model: brief.model, tokensIn: brief.tokens_in, tokensOut: brief.tokens_out })}
            </span>
            {brief.cost_usd !== null && <span className="mono">{formatUsd(brief.cost_usd)}</span>}
          </div>
        </div>

        {brief.stale && (
          <div style={s.staleNotice}>
            <Icon.AlertTriangle size={14} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
            <span>{t("staleNotice")}</span>
          </div>
        )}

        {missingFacts.length > 0 && (
          <div style={s.notice}>
            <Icon.Info size={14} style={{ color: "var(--info)", flexShrink: 0, marginTop: 1 }} />
            <span>{t("missingFacts", { facts: format.list(missingFacts) })}</span>
          </div>
        )}

        {brief.documents_read.length > 0 && (
          <div style={s.documents}>
            <div style={s.documentsLabel}>{t("documentsRead")}</div>
            <ul style={s.documentList}>
              {brief.documents_read.map((path, i) => (
                <li key={i} className="mono">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
