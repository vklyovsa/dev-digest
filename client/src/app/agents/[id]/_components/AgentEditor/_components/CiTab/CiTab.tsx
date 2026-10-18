"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { CiRunsTable, statusKey } from "@/components/ci-runs";
import { formatRanAt } from "@/components/ci-runs/CiRunsTable/helpers";
import { useCiInstallations, useCiRuns } from "@/lib/hooks/ci";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { ExportWizard } from "./_components/ExportWizard";
import { FAIL_ON_OPTIONS, HISTORY_LIMIT } from "./constants";
import { s } from "./styles";

/** Where the agent runs in CI: its installations, the Fail CI on policy and its run history. */
export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const installations = useCiInstallations(agent.id);
  const runs = useCiRuns(agent.id);
  const update = useUpdateAgent();
  const [wizard, setWizard] = React.useState<{ initialRepo: string | null } | null>(null);

  const list = installations.data ?? [];
  const shownFailOn: CiFailOn = update.isPending
    ? (update.variables?.patch.ci_fail_on ?? agent.ci_fail_on)
    : agent.ci_fail_on;

  return (
    <div style={s.stack}>
      <div>
        <h2 style={s.heading}>{t("ciTab.heading")}</h2>
        <p style={s.subtitle}>{t("ciTab.subtitle")}</p>
      </div>

      {installations.isLoading ? (
        <span role="status" style={s.muted}>
          {t("ciTab.loading")}
        </span>
      ) : installations.error ? (
        <div style={s.failure}>
          <span role="alert">
            {t("ciTab.loadError")}: {installations.error.message}
          </span>
          <Button size="sm" onClick={() => installations.refetch()}>
            {t("ciTab.retry")}
          </Button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon="Workflow"
          title={t("ciTab.emptyTitle")}
          body={t("ciTab.emptyBody")}
          cta={t("ciTab.addToCi")}
          onCta={() => setWizard({ initialRepo: null })}
        />
      ) : (
        <section>
          <h3 style={s.sectionTitle}>{t("ciTab.installationsHeading")}</h3>
          <ul style={s.list}>
            {list.map((inst) => {
              const key = statusKey(inst.latest_run_status);
              const when = formatRanAt(inst.latest_run_at);
              return (
                <li key={inst.id} style={s.row}>
                  <span style={s.repo}>{inst.repo}</span>
                  <span style={s.muted}>{t("ciTab.target")}</span>
                  <span>
                    {key
                      ? `${t(`runs.status.${key}`)}${when ? ` · ${when}` : ""}`
                      : (inst.latest_run_status ?? t("ciTab.noRunYet"))}
                  </span>
                  <span style={s.muted}>
                    {inst.manifest_version == null
                      ? t("ciTab.workflowVersionNone")
                      : t("ciTab.workflowVersion", { version: inst.manifest_version })}
                    {" · "}
                    {t("ciTab.currentVersion", { version: agent.version })}
                  </span>
                  <span style={s.spacer} />
                  <Button size="sm" onClick={() => setWizard({ initialRepo: inst.repo })}>
                    {t("ciTab.updateConfig")}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: 12 }}>
            <Button size="sm" icon="Plus" onClick={() => setWizard({ initialRepo: null })}>
              {t("ciTab.addToCi")}
            </Button>
          </div>
        </section>
      )}

      <fieldset style={s.group} disabled={update.isPending}>
        <legend style={s.sectionTitle}>{t("ciTab.failOnHeading")}</legend>
        {FAIL_ON_OPTIONS.map((value) => (
          <label key={value} style={s.option}>
            <input
              type="radio"
              name="ci-fail-on"
              checked={shownFailOn === value}
              onChange={() => update.mutate({ id: agent.id, patch: { ci_fail_on: value } })}
            />
            {t(`ciTab.failOn.${value}`)}
          </label>
        ))}
        <p style={s.note}>{t("ciTab.failOnNote")}</p>
        {update.error && (
          <span role="alert" style={s.error}>
            {t("ciTab.failOnError")}: {update.error.message}
          </span>
        )}
      </fieldset>

      <section>
        <h3 style={s.sectionTitle}>{t("ciTab.historyHeading")}</h3>
        {runs.error ? (
          <div style={s.failure}>
            <span role="alert">
              {t("runs.loadError")}: {runs.error.message}
            </span>
            <Button size="sm" onClick={() => runs.refetch()}>
              {t("runs.errorRetry")}
            </Button>
          </div>
        ) : (runs.data ?? []).length === 0 ? (
          !runs.isLoading && <span style={s.muted}>{t("runs.emptyTitle")}</span>
        ) : (
          <CiRunsTable runs={(runs.data ?? []).slice(0, HISTORY_LIMIT)} />
        )}
      </section>

      {wizard && (
        <ExportWizard
          key={wizard.initialRepo ?? "new"}
          agent={agent}
          initialRepo={wizard.initialRepo}
          onClose={() => setWizard(null)}
        />
      )}
    </div>
  );
}
