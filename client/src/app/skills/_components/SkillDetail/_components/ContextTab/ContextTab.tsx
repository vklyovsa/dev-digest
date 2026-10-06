"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import {
  AttachmentEditor,
  DEFAULT_DOC_TYPES,
  TokenSum,
  sumTokens,
  useAttachments,
} from "@/components/project-context";
import { groupByRoot } from "./helpers";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
  const state = useAttachments({ kind: "skill", id: skill.id });
  const { documents, paths, roots } = state;
  // Before both lists have arrived the badge would read "0 attached" and the sum "≈ 0 tokens".
  const known = !state.loading && !state.failed;
  const heading = (root: string | null) => {
    if (root === null) return t("skillTab.serializedHeadings.other");
    if (DEFAULT_DOC_TYPES.includes(root)) return t(`skillTab.serializedHeadings.${root}`);
    return t("skillTab.serializedHeadings.custom", { type: root });
  };
  const serialized = groupByRoot(paths, roots.length > 0 ? roots : DEFAULT_DOC_TYPES)
    .flatMap((group) => [heading(group.root), ...group.paths.map((path) => `- ${path}`)])
    .join("\n");

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
        <div style={s.tokens}>
          <TokenSum tokens={sumTokens(documents, paths, [])} />
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
