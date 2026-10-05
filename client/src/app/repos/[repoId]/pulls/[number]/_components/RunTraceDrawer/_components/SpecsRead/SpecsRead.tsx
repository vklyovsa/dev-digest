"use client";

import { useTranslations } from "next-intl";
import type { RunTrace, SpecDocRead } from "@devdigest/shared";
import { s } from "../../styles";

type SpecEntry = { path: string } & Partial<Omit<SpecDocRead, "path">>;

export function SpecsRead({ trace }: { trace: RunTrace }) {
  const t = useTranslations("runs");
  // A trace stored before project context has no `specs_docs`: paths only.
  const entries: SpecEntry[] = trace.specs_docs ?? trace.specs_read.map((path) => ({ path }));

  return (
    <div style={s.specsWrap}>
      {entries.length === 0 ? (
        <span style={s.specsNone}>{t("trace.config.none")}</span>
      ) : (
        entries.map((entry) => (
          <span key={entry.path} style={s.specEntry}>
            <span className="mono" style={s.spec}>
              {entry.path}
            </span>
            {entry.tokens != null && (
              <span style={s.specMeta}>{t("trace.config.specTokens", { count: entry.tokens })}</span>
            )}
            {entry.source === "skill" && (
              <span style={s.specMeta}>{t("trace.config.specViaSkill", { skill: entry.skill_name ?? "" })}</span>
            )}
            {entry.source === "agent" && <span style={s.specMeta}>{t("trace.config.specFromAgent")}</span>}
          </span>
        ))
      )}
    </div>
  );
}
