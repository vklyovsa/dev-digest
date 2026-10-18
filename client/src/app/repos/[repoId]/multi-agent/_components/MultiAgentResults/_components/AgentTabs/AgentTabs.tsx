"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore } from "@devdigest/ui";
import type { AgentColumn, FindingActionKind } from "@devdigest/shared";
import { FindingCard } from "@/components/finding-card";
import { durationCost } from "../../helpers";
import { s } from "./styles";

export function AgentTabs({
  columns,
  learned,
  pending,
  onAction,
  onViewTrace,
}: {
  columns: AgentColumn[];
  learned: ReadonlySet<string>;
  pending: boolean;
  onAction: (findingId: string, action: FindingActionKind) => void;
  onViewTrace: (c: AgentColumn) => void;
}) {
  const t = useTranslations("runs");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = columns.find((c) => c.run_id === selectedId) ?? columns[0];
  const nameOf = (c: AgentColumn) => (c.agent_id ? c.agent_name : t("multiAgent.deletedAgent"));

  if (!selected) return null;

  return (
    <div>
      <div style={s.tabBar}>
        {columns.map((c) => {
          const on = c.run_id === selected.run_id;
          return (
            <button key={c.run_id} type="button" aria-pressed={on} onClick={() => setSelectedId(c.run_id)} style={s.tab(on)}>
              <span>{nameOf(c)}</span>
              {c.score != null && <span className="tnum" style={s.score}>{c.score}</span>}
            </button>
          );
        })}
      </div>
      <div style={s.panel}>
        <div style={s.summaryCard}>
          {selected.score != null && <CircularScore score={selected.score} size={44} />}
          <div style={s.summaryMain}>
            <div style={s.name}>{nameOf(selected)}</div>
            <p style={s.summary}>{selected.summary ?? t("tabs.noSummary")}</p>
          </div>
          <div style={s.side}>
            <Button kind="ghost" size="sm" onClick={() => onViewTrace(selected)}>
              {t("viewTrace")}
            </Button>
            <span className="mono tnum" style={s.sub}>
              {durationCost(selected)}
            </span>
          </div>
        </div>
        {selected.status === "failed" && selected.error && <div style={s.error}>{selected.error}</div>}
        <div style={s.list}>
          {selected.findings.length === 0 && selected.status !== "running" && selected.status !== "failed" && (
            <div style={s.empty}>{t("column.noFindings")}</div>
          )}
          {selected.findings.map((f) => (
            <FindingCard
              key={f.id}
              f={f}
              pending={pending}
              onAction={(a) => onAction(f.id, a)}
              onLearn={() => onAction(f.id, "learn")}
              learned={learned.has(f.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
