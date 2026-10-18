"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { Agent, CiExportInputBody } from "@devdigest/shared";
import { useCiPreview, useDownloadCiZip, useExportCi } from "@/lib/hooks/ci";
import { useActiveRepo } from "@/lib/repo-context";
import { DEFAULT_TRIGGERS, POST_AS, SECRET_KEY, STEP_KEYS, TRIGGERS } from "./constants";
import { findWorkflow, isRepoName, isRunner, toggle } from "./helpers";
import { s } from "./styles";

type Trigger = NonNullable<CiExportInputBody["triggers"]>[number];
type PostAs = NonNullable<CiExportInputBody["post_as"]>;
type InstallMode = "pr" | "zip";

/** Four steps: choose the repository, read the files, pick triggers, install as a PR or a zip. */
export function ExportWizard({
  agent,
  initialRepo,
  onClose,
}: {
  agent: Agent;
  initialRepo?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("ci");
  const { activeRepo } = useActiveRepo();
  const preview = useCiPreview(agent.id);
  const exportCi = useExportCi(agent.id);
  const zip = useDownloadCiZip(agent.id);

  const [step, setStep] = React.useState(0);
  const [repo, setRepo] = React.useState(initialRepo ?? activeRepo?.full_name ?? "");
  const [triggers, setTriggers] = React.useState<Trigger[]>([...DEFAULT_TRIGGERS]);
  const [postAs, setPostAs] = React.useState<PostAs>("github_review");
  const [mode, setMode] = React.useState<InstallMode>("pr");
  const [editedWorkflow, setEditedWorkflow] = React.useState<string | null>(null);

  const repoName = repo.trim();
  const orderedTriggers = TRIGGERS.filter((x) => triggers.includes(x));
  const files = preview.data?.files ?? [];
  const workflow = findWorkflow(files);
  const installing = exportCi.isPending || zip.isPending;
  const installError = (mode === "pr" ? exportCi.error : zip.error)?.message ?? null;
  const prUrl = exportCi.data?.pr_url ?? null;
  const done = (mode === "pr" && exportCi.isSuccess) || (mode === "zip" && zip.isSuccess);

  const request = { repo: repoName, triggers: orderedTriggers, post_as: postAs };

  const goPreview = () => {
    setEditedWorkflow(null);
    preview.mutate(request);
    setStep(1);
  };

  const install = () => {
    const payload = { ...request, workflow_yaml: editedWorkflow ?? undefined };
    if (mode === "pr") exportCi.mutate(payload);
    else zip.mutate(payload);
  };

  const canContinue =
    step === 0
      ? isRepoName(repoName)
      : step === 1
        ? preview.isSuccess && workflow != null
        : step === 2
          ? triggers.length > 0
          : false;

  const footer = (
    <div style={s.footer}>
      {step === 0 || done ? (
        <Button kind="ghost" onClick={onClose}>
          {done ? t("exportWizard.close") : t("exportWizard.cancel")}
        </Button>
      ) : (
        <Button kind="ghost" disabled={installing} onClick={() => setStep(step - 1)}>
          {t("exportWizard.back")}
        </Button>
      )}
      {step < 3 && (
        <Button kind="primary" disabled={!canContinue} onClick={step === 0 ? goPreview : () => setStep(step + 1)}>
          {t("exportWizard.continue")}
        </Button>
      )}
      {step === 3 && !done && (
        <Button kind="primary" loading={installing} disabled={installing} onClick={install}>
          {installing ? t("exportWizard.installing") : t("exportWizard.install")}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      width={760}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name || t("exportWizard.thisAgent") })}
      onClose={onClose}
      footer={footer}
    >
      <div style={s.steps}>
        <ExportWizardSteps step={step} labels={STEP_KEYS.map((k) => t(`exportWizard.steps.${k}`))} />
      </div>
      <div style={s.body}>
        {step === 0 && (
          <>
            <div style={s.target}>
              <div>
                <div style={s.targetName}>{t("exportWizard.targets.gha")}</div>
                <div style={s.targetDesc}>{t("exportWizard.targets.ghaDesc")}</div>
              </div>
              <span style={s.badge}>{t("exportWizard.recommended")}</span>
            </div>
            <label style={s.field}>
              <span style={s.label}>{t("exportWizard.repoLabel")}</span>
              <input
                style={s.input}
                value={repo}
                placeholder={t("exportWizard.repoPlaceholder")}
                onChange={(e) => setRepo(e.target.value)}
                aria-invalid={repoName !== "" && !isRepoName(repoName)}
                spellCheck={false}
                autoComplete="off"
              />
              <span style={s.hint}>{t("exportWizard.repoHint")}</span>
            </label>
            {repoName !== "" && !isRepoName(repoName) && (
              <span role="alert" style={s.error}>
                {t("exportWizard.repoInvalid")}
              </span>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <span style={s.sectionLabel}>{t("exportWizard.filesToCreate")}</span>
            {preview.isPending && (
              <span role="status" style={s.hint}>
                {t("exportWizard.generating")}
              </span>
            )}
            {preview.error && (
              <span role="alert" style={s.error}>
                {t("exportWizard.previewError")}: {preview.error.message}
              </span>
            )}
            {files.map((file) => (
              <div key={file.path} style={s.file}>
                <div style={s.fileHead}>
                  <span style={s.filePath}>{file.path}</span>
                  <span style={s.fileMeta}>{t("exportWizard.fileSize", { bytes: file.size_bytes })}</span>
                  {file === workflow && <span style={s.fileMeta}>{t("exportWizard.editable")}</span>}
                </div>
                {file === workflow ? (
                  <textarea
                    style={s.textarea}
                    aria-label={t("exportWizard.workflowEditLabel", { path: file.path })}
                    value={editedWorkflow ?? file.contents}
                    onChange={(e) => setEditedWorkflow(e.target.value)}
                    spellCheck={false}
                  />
                ) : isRunner(file) ? null : (
                  <pre style={s.pre} aria-label={t("exportWizard.fileContentLabel", { path: file.path })}>
                    {file.contents}
                  </pre>
                )}
              </div>
            ))}
          </>
        )}

        {step === 2 && (
          <>
            <fieldset style={s.group}>
              <legend style={s.label}>{t("exportWizard.triggerLabel")}</legend>
              {TRIGGERS.map((trigger) => (
                <label key={trigger} style={s.option}>
                  <input
                    type="checkbox"
                    checked={triggers.includes(trigger)}
                    onChange={() => setTriggers(toggle(triggers, trigger))}
                  />
                  {t(`exportWizard.triggers.${trigger}`)}
                </label>
              ))}
              {triggers.length === 0 && (
                <span role="alert" style={s.error}>
                  {t("exportWizard.triggerRequired")}
                </span>
              )}
            </fieldset>
            <fieldset style={s.group}>
              <legend style={s.label}>{t("exportWizard.postResultsLabel")}</legend>
              {POST_AS.map((opt) => (
                <label key={opt.value} style={s.option}>
                  <input
                    type="radio"
                    name="ci-post-as"
                    checked={postAs === opt.value}
                    onChange={() => setPostAs(opt.value)}
                  />
                  {t(`exportWizard.postAs.${opt.labelKey}`)}
                </label>
              ))}
            </fieldset>
            <div style={s.card}>
              <span style={s.cardTitle}>{t("exportWizard.secretTitle")}</span>
              <span>{t("exportWizard.secretNote", { key: SECRET_KEY })}</span>
            </div>
            <div style={s.card}>
              <span style={s.cardTitle}>{t("exportWizard.blockMergeTitle")}</span>
              <span>{t("exportWizard.blockMergeDesc")}</span>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <fieldset style={s.group} disabled={installing}>
              <legend style={s.label}>{t("exportWizard.installOptionLabel")}</legend>
              <label style={s.option}>
                <input type="radio" name="ci-install-mode" checked={mode === "pr"} onChange={() => setMode("pr")} />
                {t("exportWizard.installCardTitle")}
              </label>
              <label style={s.option}>
                <input type="radio" name="ci-install-mode" checked={mode === "zip"} onChange={() => setMode("zip")} />
                {t("exportWizard.zipTitle")}
              </label>
            </fieldset>
            <div style={s.card}>
              <span style={s.cardTitle}>
                {mode === "pr" ? t("exportWizard.installCardTitle") : t("exportWizard.zipTitle")}
              </span>
              <span>
                {mode === "pr"
                  ? t("exportWizard.installCardBody", { repo: repoName, count: files.length })
                  : t("exportWizard.zipBody", { repo: repoName })}
              </span>
            </div>
            {installError && (
              <span role="alert" style={s.error}>
                {t("exportWizard.installError")}: {installError}
              </span>
            )}
            {done && (
              <div role="status" style={s.success}>
                {mode === "pr" ? (
                  <>
                    <strong>{t("exportWizard.prOpened")}</strong>
                    {prUrl && (
                      <a href={prUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
                        {t("exportWizard.prLink")}
                      </a>
                    )}
                  </>
                ) : (
                  <strong>{t("exportWizard.zipDownloaded")}</strong>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
