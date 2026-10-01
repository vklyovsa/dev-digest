"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi, type DiffFindingsApi } from "@/components/diff-viewer";
import {
  usePrComments,
  useCreatePrComment,
  usePrReviews,
  useFindingAction,
} from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { RoleGroup } from "./_components/RoleGroup";
import { OrderToggle } from "./_components/OrderToggle";
import type { DiffOrder } from "./constants";
import { currentFindings, diffTotals, flaggedPaths, hasReview, joinGroupFiles } from "./helpers";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}

export function DiffTab({ prId, files, canComment, repoFullName, headSha }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const { data: reviews } = usePrReviews(prId);
  const smartDiff = useSmartDiff(prId);
  const create = useCreatePrComment(prId);
  const action = useFindingAction();
  const [order, setOrder] = React.useState<DiffOrder>("smart");
  const [showAnnotations, setShowAnnotations] = React.useState(true);

  const current = currentFindings(reviews);
  const toggleCount = (comments?.length ?? 0) + current.length;
  const noReview = reviews !== undefined && !hasReview(reviews);
  const totals = diffTotals(files);

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments: showAnnotations,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowAnnotations(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : t("smartDiff.commentPostFailed"));
        throw err;
      }
    },
  };

  const findingsApi: DiffFindingsApi = {
    findings: current,
    flaggedPaths: flaggedPaths(smartDiff.data),
    showCards: showAnnotations,
    renderFinding: (f) => (
      <FindingCard
        f={f}
        defaultExpanded
        onAction={(a) => action.mutate({ findingId: f.id, action: a, prId: prId ?? undefined })}
        pending={action.isPending && action.variables?.findingId === f.id}
        repoFullName={repoFullName}
        headSha={headSha}
      />
    ),
    labels: {
      line: (severity) =>
        t.has(`smartDiff.lineLabel.${severity}`)
          ? t(`smartDiff.lineLabel.${severity}`)
          : t("smartDiff.lineLabelFallback"),
      outside: (count) => t("smartDiff.outsideDiffTitle", { count }),
      flagged: t("smartDiff.fileHasFindings"),
    },
  };

  const flat = <DiffViewer files={files} commenting={commenting} findings={findingsApi} />;
  const groups = smartDiff.data ? joinGroupFiles(smartDiff.data.groups, files) : [];

  let body: React.ReactNode;
  if (order === "original") {
    body = flat;
  } else if (smartDiff.isLoading) {
    body = <Skeleton height={120} />;
  } else if (smartDiff.isError) {
    body = (
      <>
        <div style={s.notice}>{t("smartDiff.groupingUnavailable")}</div>
        {flat}
      </>
    );
  } else if (groups.length === 0) {
    body = flat;
  } else {
    body = (
      <div style={s.groups}>
        {groups.map((g) => (
          <RoleGroup
            key={g.role}
            role={g.role}
            files={g.files}
            flaggedCount={g.flaggedCount}
            showCounter={!noReview}
            commenting={commenting}
            findings={findingsApi}
          />
        ))}
      </div>
    );
  }

  return (
    <section>
      <SectionLabel icon="Code">{t("smartDiff.heading")}</SectionLabel>
      <div style={s.toolbar}>
        <span style={s.summary}>
          {t("smartDiff.filesCount", { count: totals.files })} ·{" "}
          <span className="mono tnum">
            <span style={s.add}>+{totals.additions}</span> <span style={s.del}>−{totals.deletions}</span>
          </span>
        </span>
        {toggleCount > 0 && (
          <Button
            kind="ghost"
            size="sm"
            icon={showAnnotations ? "EyeOff" : "Eye"}
            onClick={() => setShowAnnotations((v) => !v)}
          >
            {t(showAnnotations ? "smartDiff.hideComments" : "smartDiff.showComments", { count: toggleCount })}
          </Button>
        )}
        <OrderToggle value={order} onChange={setOrder} />
      </div>
      {noReview && <div style={s.hint}>{t("smartDiff.noReviewHint")}</div>}
      {body}
    </section>
  );
}
