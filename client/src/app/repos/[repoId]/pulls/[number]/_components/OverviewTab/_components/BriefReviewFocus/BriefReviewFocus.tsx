"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel } from "@devdigest/ui";
import type { ReviewFocusItem } from "@devdigest/shared";
import { s } from "./styles";

interface BriefReviewFocusProps {
  items: ReviewFocusItem[];
  hrefFor: (file: string, line: number) => string;
  onFollow: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
}

export function BriefReviewFocus({ items, hrefFor, onFollow }: BriefReviewFocusProps) {
  const t = useTranslations("brief");

  return (
    <section aria-label={t("block.reviewFocus")}>
      <SectionLabel icon="ListChecks">{t("block.reviewFocus")}</SectionLabel>
      <Card>
        {items.length === 0 ? (
          <p style={s.empty}>{t("noReviewFocus")}</p>
        ) : (
          <ol style={s.list}>
            {items.map((item, i) => {
              const href = hrefFor(item.file, item.line);
              return (
                <li key={i} style={s.item}>
                  <a className="mono" href={href} onClick={(e) => onFollow(e, href)} style={s.target}>
                    {item.file}:{item.line}
                  </a>
                  <span style={s.reason}>{item.reason}</span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </section>
  );
}
