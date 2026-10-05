"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { AttachmentEditor, sumTokens, useAttachments } from "@/components/project-context";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
  const state = useAttachments({ kind: "skill", id: skill.id });
  const { documents, paths } = state;
  // Before both lists have arrived the badge would read "0 attached" and the sum "≈ 0 tokens".
  const known = !state.loading && !state.failed;
  const serialized = [t("skillTab.serializedHeading"), ...paths.map((path) => `- ${path}`)].join("\n");

  return (
    <div>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skillTab.title")}</h2>
        {known && (
          <Badge color="var(--accent)" bg="var(--accent-bg)">
            {t("skillTab.count", { count: paths.length })}
          </Badge>
        )}
      </div>
      <p style={s.hint}>{t("skillTab.inherit")}</p>
      <AttachmentEditor state={state} preview="icon" />
      {known && state.repoState === "ready" && (
        <div className="mono tnum" style={s.tokens}>
          {t("attach.tokens", { count: sumTokens(documents, paths, []) })}
        </div>
      )}
      {paths.length > 0 && (
        <>
          <div style={s.serializesAs}>{t("skillTab.serializesAs")}</div>
          <pre className="mono" style={s.serialized}>
            {serialized}
          </pre>
        </>
      )}
    </div>
  );
}
