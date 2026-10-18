"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, SectionLabel, SeverityBadge, type Severity } from "@devdigest/ui";
import type { AgentColumn, FindingGroup } from "@devdigest/shared";
import { groupLabel, isKnownSeverity } from "../../helpers";
import { s } from "./styles";

export function Disagreements({ groups, columns }: { groups: FindingGroup[]; columns: AgentColumn[] }) {
  const t = useTranslations("runs");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  const doneCount = columns.filter((c) => c.status === "done").length;
  const rows = onlyConflicts ? groups.filter((g) => g.conflict) : groups;

  return (
    <div style={s.root}>
      <SectionLabel
        icon="Activity"
        right={
          <Checkbox checked={onlyConflicts} onChange={setOnlyConflicts} label={t("conflicts.onlyConflicts")} />
        }
      >
        {t("conflicts.title")}
      </SectionLabel>
      {doneCount < 2 ? (
        <div style={s.note}>{t("multiAgent.needsTwoAgents")}</div>
      ) : rows.length === 0 ? (
        <div style={s.note}>{t("conflicts.empty")}</div>
      ) : (
        <div style={s.list}>
          {rows.map((g, i) => (
            <div key={`${g.file}:${g.start_line}:${i}`} style={s.group}>
              <div style={s.groupHead}>
                <span className="mono" style={s.file}>
                  {groupLabel(g)}
                </span>
                <span style={s.title}>{g.title}</span>
              </div>
              <div style={s.takes(Math.max(g.takes.length, 1))}>
                {g.takes.map((tk) => (
                  <div key={tk.run_id} style={s.take}>
                    <div style={s.takeAgent}>{tk.agent_id ? tk.agent_name : t("multiAgent.deletedAgent")}</div>
                    {tk.verdict === "ignored" ? (
                      <span style={s.didNotFlag}>{t("conflicts.didNotFlag")}</span>
                    ) : isKnownSeverity(tk.verdict) ? (
                      <SeverityBadge severity={tk.verdict as Severity} compact />
                    ) : (
                      <span style={s.didNotFlag}>{tk.verdict}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
