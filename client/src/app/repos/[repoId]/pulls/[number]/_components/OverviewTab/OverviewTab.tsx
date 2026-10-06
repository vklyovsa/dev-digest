"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { SectionLabel } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks/brief";
import { diffTargetHref } from "../../helpers";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { BriefReviewFocus } from "./_components/BriefReviewFocus";
import { BriefRiskAreas } from "./_components/BriefRiskAreas";
import { IntentCard } from "./_components/IntentCard";
import { PrBriefSummary } from "./_components/PrBriefSummary";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
}

export function OverviewTab({ prId, prBody, repoId, repoFullName, headSha }: OverviewTabProps) {
  const router = useRouter();
  const { number } = useParams<{ number: string }>();
  const shown = usePrBrief(prId).data?.brief ?? null;

  const hrefFor = (file: string, line?: number) => diffTargetHref({ repoId, number, file, line });

  const onFollow = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.push(href);
  };

  return (
    <>
      {prId && <PrBriefSummary prId={prId} />}

      {prId && (
        <div style={s.briefRow}>
          <div style={s.intentCell}>
            <IntentCard prId={prId} hideRiskAreas={shown !== null} />
          </div>
          <div style={s.blastCell}>
            <BlastRadiusCard prId={prId} repoId={repoId} repoFullName={repoFullName} headSha={headSha} />
          </div>
        </div>
      )}

      {shown && <BriefRiskAreas risks={shown.risks.risks} hrefFor={hrefFor} onFollow={onFollow} />}
      {shown && <BriefReviewFocus items={shown.review_focus} hrefFor={hrefFor} onFollow={onFollow} />}

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
