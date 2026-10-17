"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { Direction } from "../helpers";

const ICONS = { up: Icon.ArrowUp, down: Icon.ArrowDown, same: Icon.Slash } as const;

/**
 * A difference with its direction. The direction is an icon with an accessible
 * name, so it never rests on colour alone. `quality` colours up as good and down
 * as bad; `neutral` (cost) carries the direction and no verdict.
 */
export function DeltaMark({
  direction,
  tone = "quality",
  children,
}: {
  direction: Direction;
  tone?: "quality" | "neutral";
  children: React.ReactNode;
}) {
  const t = useTranslations("eval");
  const DirectionIcon = ICONS[direction];
  const color =
    tone === "neutral" || direction === "same"
      ? "var(--text-muted)"
      : direction === "up"
        ? "var(--ok)"
        : "var(--crit)";
  return (
    <span
      className="tnum"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 13,
        fontWeight: 600,
        color,
      }}
    >
      <span role="img" aria-label={t(`runs.direction.${direction}`)} style={{ display: "inline-flex" }}>
        <DirectionIcon size={12} />
      </span>
      {children}
    </span>
  );
}
