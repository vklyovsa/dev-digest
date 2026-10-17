"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { PERIOD_KINDS } from "../../../../constants";
import { validateCustom, type CustomError, type Period } from "../../../../helpers";
import { s } from "./styles";

export function PeriodPicker({
  period,
  today,
  onSelect,
}: {
  period: Period;
  today: string;
  onSelect: (period: Period) => void;
}) {
  const t = useTranslations("agentPerformance");
  const [editing, setEditing] = React.useState(false);
  const [start, setStart] = React.useState(period.kind === "custom" ? period.start : "");
  const [end, setEnd] = React.useState(period.kind === "custom" ? period.end : "");
  const [error, setError] = React.useState<CustomError | null>(null);
  const showCustom = editing || period.kind === "custom";

  const choose = (kind: (typeof PERIOD_KINDS)[number]) => {
    if (kind === "custom") {
      setEditing(true);
      return;
    }
    setEditing(false);
    setError(null);
    onSelect({ kind });
  };

  const apply = () => {
    const err = validateCustom(start, end, today);
    setError(err);
    if (err === null) onSelect({ kind: "custom", start, end });
  };

  return (
    <div style={s.wrap}>
      <div style={s.group} role="group" aria-label={t("period.label")}>
        {PERIOD_KINDS.map((kind) => (
          <Button
            key={kind}
            kind={period.kind === kind ? "primary" : "secondary"}
            size="sm"
            aria-pressed={period.kind === kind}
            onClick={() => choose(kind)}
          >
            {t(`period.choices.${kind}`)}
          </Button>
        ))}
      </div>
      {showCustom && (
        <div style={s.custom}>
          <label style={s.field}>
            {t("period.custom.start")}
            <input
              type="date"
              value={start}
              max={today}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label style={s.field}>
            {t("period.custom.end")}
            <input type="date" value={end} max={today} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <Button kind="secondary" size="sm" disabled={!start || !end} onClick={apply}>
            {t("period.custom.apply")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" style={s.error}>
          {t(`period.custom.${error}`)}
        </p>
      )}
    </div>
  );
}
