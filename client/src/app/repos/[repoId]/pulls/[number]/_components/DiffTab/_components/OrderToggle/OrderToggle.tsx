"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { DiffOrder } from "../../constants";
import { s, segmentFor } from "../../styles";

export function OrderToggle({ value, onChange }: { value: DiffOrder; onChange: (v: DiffOrder) => void }) {
  const t = useTranslations("prReview");
  const segments: { order: DiffOrder; label: string }[] = [
    { order: "smart", label: t("smartDiff.smartOrder") },
    { order: "original", label: t("smartDiff.originalOrder") },
  ];
  return (
    <div role="group" aria-label={t("smartDiff.orderLabel")} style={s.segmented}>
      {segments.map(({ order, label }) => (
        <Button
          key={order}
          kind="tertiary"
          size="sm"
          active={value === order}
          aria-pressed={value === order}
          style={segmentFor(value === order)}
          onClick={() => onChange(order)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
