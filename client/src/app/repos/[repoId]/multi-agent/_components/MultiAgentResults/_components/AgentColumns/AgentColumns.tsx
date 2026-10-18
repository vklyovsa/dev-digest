"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { durationCost, findingLine } from "../../helpers";
import { s } from "./styles";

export function AgentColumns({
  columns,
  onViewTrace,
}: {
  columns: AgentColumn[];
  onViewTrace: (c: AgentColumn) => void;
}) {
  const t = useTranslations("runs");
  return (
    <div style={s.grid(Math.max(columns.length, 1))}>
      {columns.map((c) => (
        <div key={c.run_id} style={s.column}>
          <div style={s.header}>
            <div style={s.headerMain}>
              <div style={s.name}>{c.agent_id ? c.agent_name : t("multiAgent.deletedAgent")}</div>
              <div style={s.status}>{t(`multiAgent.status.${c.status}`)}</div>
              <div className="mono tnum" style={s.sub}>
                {durationCost(c)}
              </div>
            </div>
            {c.score != null && <CircularScore score={c.score} size={32} stroke={3.5} />}
          </div>
          <div style={s.list}>
            {c.status === "failed" && c.error && <div style={s.errorText}>{c.error}</div>}
            {c.findings.length === 0 && c.status !== "failed" && c.status !== "running" && (
              <div style={s.empty}>{t("column.noFindings")}</div>
            )}
            {c.findings.map((f) => (
              <div key={f.id} style={s.finding}>
                <div style={s.findingTitle}>{f.title}</div>
                <span className="mono" style={s.findingFile}>
                  {f.file}:{findingLine(f)}
                </span>
              </div>
            ))}
          </div>
          <div style={s.footer}>
            <Button kind="ghost" size="sm" onClick={() => onViewTrace(c)}>
              {t("viewTrace")}
            </Button>
            <span style={s.count}>{t("column.findingsCount", { count: c.findings.length })}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
