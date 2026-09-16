/* RunCostBadge — what one agent run cost, in the two shapes the app needs:
   `compact` for the PR list's COST column, `detailed` for the run timeline,
   where the cost sits under the run time next to its token count. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { formatUsd, totalTokens, NO_COST } from "./helpers";

export interface RunCostBadgeProps {
  costUsd: number | null | undefined;
  /** `detailed` only — rendered as "9,119 tok · $0.0013". */
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: "compact" | "detailed";
  style?: React.CSSProperties;
}

export function RunCostBadge({
  costUsd,
  tokensIn,
  tokensOut,
  variant = "compact",
  style,
}: RunCostBadgeProps) {
  const t = useTranslations("common");
  const cost = formatUsd(costUsd);

  if (variant === "compact") {
    return (
      <span
        className="mono tnum"
        style={{
          fontSize: 12,
          color: cost === NO_COST ? "var(--text-muted)" : "var(--text-secondary)",
          ...style,
        }}
      >
        {cost}
      </span>
    );
  }

  const tokens = totalTokens(tokensIn, tokensOut);
  return (
    <span className="tnum" style={{ fontSize: 11, color: "var(--text-muted)", ...style }}>
      {tokens != null && `${t("runCost.tokens", { count: tokens })} · `}
      {cost}
    </span>
  );
}

export default RunCostBadge;
