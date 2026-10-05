"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { AttachmentEditor, sumTokens, useAttachments } from "@/components/project-context";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("context");
  const state = useAttachments({ kind: "agent", id: agent.id });
  const { documents, paths, inherited } = state;
  // Before both lists have arrived the badge would read "0 of 0" and the sum "≈ 0 tokens".
  const known = state.repoState === "ready" && !state.loading && !state.failed;

  return (
    <div>
      <div style={s.header}>
        <h2 style={s.h2}>{t("agentTab.title")}</h2>
        {known && (
          <Badge color="var(--accent)" bg="var(--accent-bg)">
            {t("agentTab.count", { attached: paths.length, total: documents.length })}
          </Badge>
        )}
      </div>
      <p style={s.hint}>{t("agentTab.hint")}</p>
      <AttachmentEditor state={state} preview="button" />
      {known && (
        <div style={s.footer}>
          <span className="mono tnum" style={s.tokens}>
            {t("attach.tokens", { count: sumTokens(documents, paths, inherited) })}
          </span>
          <span style={s.note}>{t("agentTab.note")}</span>
        </div>
      )}
    </div>
  );
}
