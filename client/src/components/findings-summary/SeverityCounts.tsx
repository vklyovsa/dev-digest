/* SeverityCounts — "⊙ 2  ⚠ 2  ✳ 1": how a run's findings split by severity,
   read-only. Used by the PR list's FINDINGS column and by the run tiles in the
   PR timeline; the clickable variant lives in the review-run card's
   FindingsPanel, which owns the filter state. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, type Severity } from "@devdigest/ui";
import type { SeverityCount } from "@devdigest/shared";

export function SeverityCounts({
  counts,
  iconSize = 13,
  style,
}: {
  counts: readonly SeverityCount[];
  iconSize?: number;
  style?: React.CSSProperties;
}) {
  const t = useTranslations("prReview");
  if (counts.length === 0) return null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, ...style }}>
      {counts.map(({ severity, count }) => {
        const tok = SEV[severity as Severity];
        const SevIcon = Icon[tok.icon];
        const label = t(`findingsSummary.countLabel`, {
          count,
          severity: t(`findingsSummary.severity.${severity}`),
        });
        return (
          <span
            key={severity}
            className="tnum"
            title={label}
            aria-label={label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
              color: tok.c,
            }}
          >
            <SevIcon size={iconSize} />
            {count}
          </span>
        );
      })}
    </span>
  );
}

export default SeverityCounts;
