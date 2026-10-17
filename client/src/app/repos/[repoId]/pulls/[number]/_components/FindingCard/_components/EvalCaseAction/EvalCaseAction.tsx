"use client";

import React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { EvalCase, EvalCaseDraftResponse, FindingRecord } from "@devdigest/shared";
import { CaseEditorDialog } from "@/components/eval-case-editor";
import { useEvalCaseDraft } from "@/lib/hooks/evals";
import { s } from "./styles";

export function EvalCaseAction({ finding }: { finding: FindingRecord }) {
  const t = useTranslations("prReview");
  const draft = useEvalCaseDraft();
  const hintId = React.useId();
  const anchor = React.useRef<HTMLSpanElement>(null);
  const [opened, setOpened] = React.useState<EvalCaseDraftResponse | null>(null);
  const [saved, setSaved] = React.useState<{ case: EvalCase; created: boolean } | null>(null);
  const wasOpen = React.useRef(false);

  React.useEffect(() => {
    if (wasOpen.current && !opened) anchor.current?.querySelector("button")?.focus();
    wasOpen.current = !!opened;
  }, [opened]);

  const accepted = !!finding.accepted_at;
  const dismissed = !!finding.dismissed_at;
  const decided = accepted || dismissed;
  const title = !decided
    ? t("finding.evalCase.undecidedHint")
    : accepted
      ? t("finding.evalCase.titleAccepted")
      : t("finding.evalCase.titleDismissed");

  return (
    <>
      <span ref={anchor} style={s.anchor}>
        <Button
          kind="ghost"
          size="sm"
          icon="FlaskConical"
          disabled={!decided || draft.isPending}
          title={title}
          aria-describedby={decided ? undefined : hintId}
          onClick={() => draft.mutate(finding.id, { onSuccess: setOpened })}
        >
          {t("finding.evalCase.action")}
        </Button>
      </span>
      {!decided && (
        <span id={hintId} style={s.hint}>
          {t("finding.evalCase.undecidedHint")}
        </span>
      )}
      {draft.isPending && (
        <span role="status" style={s.hint}>
          {t("finding.evalCase.loading")}
        </span>
      )}
      {draft.isError && (
        <span role="alert" style={s.error}>
          {draft.error.message}
        </span>
      )}
      {opened &&
        createPortal(
          <CaseEditorDialog
            key={finding.id}
            agent={opened.agent}
            evalCase={opened.case}
            source={opened.draft ? { findingId: finding.id, draft: opened.draft } : undefined}
            onClose={() => setOpened(null)}
            onSaved={setSaved}
          />,
          document.body,
        )}
      {!opened && saved && (
        <span role="status" style={s.created}>
          {saved.created
            ? saved.case.expectation_type === "must_find"
              ? t("finding.evalCase.createdMustFind")
              : t("finding.evalCase.createdMustNotFlag")
            : t("finding.evalCase.alreadyExists")}
          <Link href={`/agents/${saved.case.owner_id}?tab=evals`} style={s.link}>
            {t("finding.evalCase.openEvals")}
          </Link>
        </span>
      )}
    </>
  );
}
