"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile, SmartDiffRole } from "@devdigest/shared";
import { DiffViewer, type DiffCommentApi, type DiffFindingsApi } from "@/components/diff-viewer";
import { ROLE_META } from "../../constants";
import { s, groupChevron } from "../../styles";

export function RoleGroup({
  role,
  files,
  flaggedCount,
  showCounter,
  commenting,
  findings,
}: {
  role: SmartDiffRole;
  files: PrFile[];
  flaggedCount: number;
  showCounter: boolean;
  commenting: DiffCommentApi;
  findings: DiffFindingsApi;
}) {
  const t = useTranslations("prReview");
  const meta = ROLE_META[role];
  const [open, setOpen] = React.useState(meta.defaultOpen);

  return (
    <section>
      <div style={s.groupHeaderWrap}>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={s.groupHeader}>
          <Icon.ChevronRight size={13} style={groupChevron(open)} />
          <span aria-hidden style={{ ...s.swatch, background: meta.swatch }} />
          <span style={s.groupLabel}>{t(`smartDiff.${meta.labelKey}`)}</span>
          <span style={s.groupDescription}>{t(`smartDiff.${meta.descriptionKey}`)}</span>
          {showCounter && flaggedCount > 0 && (
            <span role="img" aria-label={t("smartDiff.groupFlagged", { count: flaggedCount })} style={s.groupFlagged}>
              <span aria-hidden style={s.flaggedDot} />
              <span aria-hidden>{flaggedCount}</span>
            </span>
          )}
          <span style={s.groupCount}>{t("smartDiff.filesCount", { count: files.length })}</span>
        </button>
      </div>
      {open && (
        <div style={s.groupBody}>
          <DiffViewer files={files} commenting={commenting} findings={findings} />
        </div>
      )}
    </section>
  );
}
