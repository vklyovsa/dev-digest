"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, MonoLink } from "@devdigest/ui";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { countSymbolsWithoutCallers, kindBySymbol, symbolLabel } from "../../helpers";
import { chevron, s } from "../../styles";

interface BlastTreeProps {
  data: BlastRadiusResponse;
  repoFullName: string | null;
  sha: string;
}

export function BlastTree({ data, repoFullName, sha }: BlastTreeProps) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(data.downstream.slice(0, 1).map((g) => g.symbol)));
  const kinds = kindBySymbol(data.changed_symbols);
  const withoutCallers = countSymbolsWithoutCallers(data);

  const toggle = (symbol: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(symbol)) next.add(symbol);
      return next;
    });

  return (
    <div>
      {data.downstream.map((group) => {
        const isOpen = open.has(group.symbol);
        const atCap = group.callers.length >= data.max_callers_per_symbol;
        return (
          <div key={group.symbol}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(group.symbol)}
              style={isOpen ? { ...s.symbolRow, ...s.symbolRowOpen } : s.symbolRow}
            >
              <Icon.ChevronRight size={13} style={chevron(isOpen)} />
              <Icon.Code size={14} style={s.symbolIcon} />
              <span className="mono" style={s.symbolName}>
                {symbolLabel(group.symbol, kinds.get(group.symbol))}
              </span>
              <span style={s.callerCount}>{t("callerCount", { count: group.callers.length })}</span>
            </button>

            {isOpen && (
              <div style={s.groupBody}>
                <ul style={s.callerList}>
                  {group.callers.map((caller) => {
                    const ref = `${caller.file}:${caller.line}`;
                    return (
                      <li key={`${ref}:${caller.name}`} style={s.callerItem}>
                        <Icon.CornerDownRight size={13} style={s.callerIcon} />
                        <span style={s.callerLink}>
                          {repoFullName ? (
                            <MonoLink href={githubBlobUrl(repoFullName, sha, caller.file, caller.line)}>{ref}</MonoLink>
                          ) : (
                            <span className="mono">{ref}</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {atCap && <p style={s.note}>{t("capNote", { count: data.max_callers_per_symbol })}</p>}

                {group.endpoints_affected.length > 0 && (
                  <div role="group" aria-label={t("endpointsLabel")} style={s.factRow}>
                    {group.endpoints_affected.map((endpoint) => (
                      <Badge key={endpoint} mono icon="Globe" color="var(--accent-text)" bg="var(--accent-bg)">
                        {endpoint}
                      </Badge>
                    ))}
                  </div>
                )}
                {group.crons_affected.length > 0 && (
                  <div role="group" aria-label={t("cronsLabel")} style={s.factRow}>
                    {group.crons_affected.map((cron) => (
                      <Badge key={cron} mono icon="Clock" color="var(--warn)" bg="var(--warn-bg)">
                        {cron}
                      </Badge>
                    ))}
                  </div>
                )}
                {group.endpoints_affected.length === 0 && group.crons_affected.length === 0 && (
                  <p style={s.muted}>{t("noEndpoints")}</p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {withoutCallers > 0 && <p style={s.muted}>{t("moreWithoutCallers", { count: withoutCallers })}</p>}
    </div>
  );
}
