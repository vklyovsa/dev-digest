"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, Icon, SectionLabel } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { RISK_SEVERITY_COLOR } from "./constants";
import { s } from "./styles";

interface BriefRiskAreasProps {
  risks: Risk[];
  hrefFor: (file: string) => string;
  onFollow: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
}

export function BriefRiskAreas({ risks, hrefFor, onFollow }: BriefRiskAreasProps) {
  const t = useTranslations("brief");

  return (
    <section aria-label={t("block.risks")}>
      <SectionLabel icon="AlertTriangle">{t("block.risks")}</SectionLabel>
      <Card>
        {risks.length === 0 ? (
          <p style={s.empty}>{t("noRisks")}</p>
        ) : (
          <ul style={s.list}>
            {risks.map((risk, i) => (
              <RiskItem key={`${risk.kind}:${risk.title}:${i}`} risk={risk} hrefFor={hrefFor} onFollow={onFollow} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

interface RiskItemProps {
  risk: Risk;
  hrefFor: (file: string) => string;
  onFollow: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
}

function RiskItem({ risk, hrefFor, onFollow }: RiskItemProps) {
  const t = useTranslations("brief");
  const [open, setOpen] = React.useState(false);

  return (
    <li style={s.item}>
      <div style={s.head}>
        <div style={s.main}>
          <div style={s.titleRow}>
            <span role="img" aria-label={t(`risk.severity.${risk.severity}`)} style={s.severity(RISK_SEVERITY_COLOR[risk.severity])}>
              <Icon.AlertTriangle size={14} />
            </span>
            <span>{risk.title}</span>
            <span style={s.kind}>{risk.kind}</span>
          </div>
          <div style={s.paths}>
            {risk.file_refs.map((path, i) => {
              const href = hrefFor(path);
              return (
                <a key={i} className="mono" href={href} onClick={(e) => onFollow(e, href)} style={s.path}>
                  {path}
                </a>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={t(open ? "risk.collapse" : "risk.expand", { title: risk.title })}
          onClick={() => setOpen((o) => !o)}
          style={s.toggle}
        >
          <Icon.ChevronDown size={16} style={s.chevron(open)} />
        </button>
      </div>
      {open && <p style={s.explanation}>{risk.explanation}</p>}
    </li>
  );
}
