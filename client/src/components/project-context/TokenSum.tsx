"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { CONTEXT_TOKEN_BUDGET } from "./constants";

const WRAP: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 10 };
const sumStyle = (over: boolean): React.CSSProperties => ({
  fontWeight: 600,
  color: over ? "var(--crit)" : "var(--text-secondary)",
});

export function TokenSum({ tokens }: { tokens: number }) {
  const t = useTranslations("context");
  const over = tokens > CONTEXT_TOKEN_BUDGET;
  return (
    <span style={WRAP}>
      <span className="mono tnum" style={sumStyle(over)}>
        {t("attach.tokens", { count: tokens })}
      </span>
      <span role="status">
        {over && (
          <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertTriangle">
            {t("attach.overBudget", { budget: CONTEXT_TOKEN_BUDGET })}
          </Badge>
        )}
      </span>
    </span>
  );
}

export default TokenSum;
