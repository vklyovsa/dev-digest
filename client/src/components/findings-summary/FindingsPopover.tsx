/* FindingsPopover — hover card listing findings, READ-ONLY: severity, title,
   category, file:line, confidence and a short rationale, with no action
   buttons (accept/dismiss live on the PR page, in the review-run card).

   The header is "N FINDINGS IN THIS RUN" on both surfaces — the wording the
   acceptance criteria fix for this card. On a timeline tile that is literally
   one run; on the PR list the set spans each agent's latest run, and the
   heading is kept verbatim anyway (see specs/findings-by-severity.md).

   Positioned `fixed` off the trigger's rect on purpose: the PR list's table
   card is `overflow: hidden`, so an absolutely-positioned card would be
   clipped on the lower rows. Flips above the trigger when there is no room
   below. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, SeverityBadge, CategoryTag, ConfidenceNum, type Severity, type Category } from "@devdigest/ui";
import type { FindingPreview } from "@devdigest/shared";
import { PREVIEW_LIMIT } from "./helpers";

const CARD_WIDTH = 380;
const CARD_MAX_HEIGHT = 340;
const GAP = 8;
const EDGE = 12;

type Placement = { top: number; left: number; above: boolean };

function placeFor(rect: DOMRect): Placement {
  const above = rect.bottom + CARD_MAX_HEIGHT > window.innerHeight && rect.top > CARD_MAX_HEIGHT;
  return {
    top: above ? rect.top - GAP : rect.bottom + GAP,
    left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - CARD_WIDTH - EDGE)),
    above,
  };
}

export function FindingsPopover({
  total,
  previews,
  limit = PREVIEW_LIMIT,
  children,
  style,
}: {
  /** Findings in the set — may exceed `previews.length`. */
  total: number;
  previews: readonly FindingPreview[];
  limit?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = useTranslations("prReview");
  const anchor = React.useRef<HTMLSpanElement | null>(null);
  const [place, setPlace] = React.useState<Placement | null>(null);

  if (previews.length === 0) return <>{children}</>;

  const shown = previews.slice(0, limit);
  const rest = total - shown.length;

  return (
    <span
      ref={anchor}
      onMouseEnter={() => setPlace(placeFor(anchor.current!.getBoundingClientRect()))}
      onMouseLeave={() => setPlace(null)}
      style={{ display: "inline-flex", alignItems: "center", ...style }}
    >
      {children}
      {place && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            top: place.top,
            left: place.left,
            transform: place.above ? "translateY(-100%)" : undefined,
            width: CARD_WIDTH,
            maxHeight: CARD_MAX_HEIGHT,
            overflowY: "auto",
            zIndex: 60,
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg-elevated)",
            boxShadow: "0 12px 32px rgba(0,0,0,.45)",
            padding: "12px 14px",
            cursor: "default",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "var(--text-muted)",
              marginBottom: 10,
            }}
          >
            <Icon.Info size={12} />
            {t("findingsSummary.popoverTitle", { count: total })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {shown.map((f) => {
              const tok = SEV[f.severity as Severity];
              return (
                <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <SeverityBadge severity={f.severity as Severity} compact />
                    <span style={{ fontSize: 13, fontWeight: 600, color: tok.c }}>{f.title}</span>
                    <CategoryTag category={f.category as Category} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {/* Plain text, not MonoLink: that primitive renders a
                        <button>, and this card carries no controls. */}
                    <span className="mono" style={{ fontSize: 12, color: "var(--accent-text)" }}>
                      {f.file}:{f.start_line}
                      {f.end_line !== f.start_line ? `-${f.end_line}` : ""}
                    </span>
                    <ConfidenceNum value={f.confidence} />
                  </div>
                  <p
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: "var(--text-secondary)",
                      margin: 0,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {f.rationale}
                  </p>
                </div>
              );
            })}
            {rest > 0 && (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("findingsSummary.more", { count: rest })}
              </span>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

export default FindingsPopover;
