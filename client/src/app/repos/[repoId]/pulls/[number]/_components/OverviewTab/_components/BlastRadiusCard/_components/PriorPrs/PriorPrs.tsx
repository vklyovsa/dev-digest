"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Avatar, Badge, Icon, MonoLink, Skeleton } from "@devdigest/ui";
import type { BlastHistoryResponse } from "@devdigest/shared";
import { githubPrUrl } from "@/lib/github-urls";
import { useBlastHistory } from "@/lib/hooks/blast";
import { HISTORY_FILES_SHOWN } from "../../constants";
import { isoDay } from "../../helpers";
import { historyChevron, s } from "../../styles";

interface PriorPrsProps {
  prId: string;
  repoFullName: string | null;
}

export function PriorPrs({ prId, repoFullName }: PriorPrsProps) {
  const t = useTranslations("blast");
  const { data, isLoading } = useBlastHistory(prId);
  const [open, setOpen] = React.useState(false);

  return (
    <div style={s.historyBox}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={s.historyHeader}>
        <Icon.History size={14} style={s.historyIcon} />
        <span>{t("history.title")}</span>
        {data?.available && <Badge>{data.history.length}</Badge>}
        <Icon.ChevronDown size={14} style={historyChevron(open)} />
      </button>
      {open && <HistoryBody data={data} isLoading={isLoading} repoFullName={repoFullName} />}
    </div>
  );
}

interface HistoryBodyProps {
  data: BlastHistoryResponse | undefined;
  isLoading: boolean;
  repoFullName: string | null;
}

function HistoryBody({ data, isLoading, repoFullName }: HistoryBodyProps) {
  const t = useTranslations("blast");

  if (isLoading) {
    return (
      <div style={s.historyEmpty}>
        <Skeleton height={14} width="70%" />
      </div>
    );
  }
  if (!data || !data.available) {
    return <p style={s.historyEmpty}>{t(`history.unavailable.${data?.unavailable_reason ?? "github_error"}`)}</p>;
  }
  if (data.history.length === 0) return <p style={s.historyEmpty}>{t("history.empty")}</p>;

  return (
    <ul style={s.historyList}>
      {data.history.map((item) => {
        const shown = item.files_overlap.slice(0, HISTORY_FILES_SHOWN);
        const rest = item.files_overlap.length - shown.length;
        const heading = `#${item.pr_number} ${item.title}`;
        return (
          <li key={item.pr_number} style={s.historyItem}>
            <div style={s.historyTitle}>
              {repoFullName ? (
                <MonoLink href={githubPrUrl(repoFullName, item.pr_number)}>{heading}</MonoLink>
              ) : (
                <span className="mono">{heading}</span>
              )}
            </div>
            <div style={s.historyMeta}>
              <Avatar name={item.author} size={16} />
              <span>{`${item.author} · ${isoDay(item.merged_at)}`}</span>
              <span>{t("history.overlap", { count: item.files_overlap.length })}</span>
            </div>
            <div style={s.historyFiles}>
              {shown.map((path) => (
                <span key={path} className="mono">
                  {path}
                </span>
              ))}
              {rest > 0 && <span>{t("history.moreFiles", { count: rest })}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
