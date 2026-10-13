/* CaseEditorDialog — create an eval case by hand, or edit one. Two columns: the
   input (name, diff with a live preview, PR meta) and the expected output as
   separate fields. Form values are the one deliberate local copy; everything
   else is derived during render. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, SelectInput, Tabs, TextInput, Textarea } from "@devdigest/ui";
import type { EvalCase, EvalCaseDraft, EvalExpectationType } from "@devdigest/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DiffViewer } from "@/components/diff-viewer";
import {
  useCreateManualEvalCase,
  useSaveEvalCaseFromFinding,
  useTryEvalCase,
  useUpdateEvalCase,
} from "@/lib/hooks/evals";
import { expectedCount, skillOwner, type SkillEvalTarget } from "@/components/eval-runs";
import { CATEGORIES, NAME_MAX_LENGTH, SEVERITIES } from "./constants";
import {
  canSave,
  fileAfterDiffChange,
  initialValues,
  initialValuesFromDraft,
  isDirty,
  lineRange,
  splitDiffFiles,
  toCreateBody,
  toTryBody,
  toUpdateBody,
  tryMeta,
  type FormValues,
} from "./helpers";
import { TryResult } from "./TryResult";
import { s } from "./styles";

type InputTab = "diff" | "prMeta";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={s.field}>
      <span style={s.label}>
        {label}
        {required && (
          <span aria-hidden="true" style={s.star}>
            *
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

/** The listed values plus the case's own, when it holds one the list does not. */
function withCurrent(values: readonly string[], current: string): string[] {
  return current !== "" && !values.includes(current) ? [...values, current] : [...values];
}

type CaseEditorOwnerProps =
  | { agent: { id: string; name: string }; source?: { findingId: string; draft: EvalCaseDraft }; skill?: undefined }
  | { skill: SkillEvalTarget; agent?: undefined; source?: undefined };

export type CaseEditorDialogProps = CaseEditorOwnerProps & {
  evalCase: EvalCase | null;
  onClose: () => void;
  onSaved?: (saved: { case: EvalCase; created: boolean }) => void;
};

const NO_HOST_ID = "eval-case-editor-no-host";

export function CaseEditorDialog({ agent, skill, evalCase, source, onClose, onSaved }: CaseEditorDialogProps) {
  const t = useTranslations("eval");
  const owner = skill ? skillOwner(skill) : agent.id;
  const canRun = !skill || skill.host !== null;
  const create = useCreateManualEvalCase(owner);
  const update = useUpdateEvalCase(owner);
  const fromFinding = useSaveEvalCaseFromFinding();
  const tryCase = useTryEvalCase(owner);

  const [current, setCurrent] = React.useState<EvalCase | null>(evalCase);
  const [initial, setInitial] = React.useState<FormValues>(() =>
    source ? initialValuesFromDraft(source.draft) : initialValues(evalCase),
  );
  const [values, setValues] = React.useState<FormValues>(initial);
  const [runOnSave, setRunOnSave] = React.useState(true);
  const mode = current ? "edit" : source ? "finding" : "new";
  const [tab, setTab] = React.useState<InputTab>("diff");
  const [confirming, setConfirming] = React.useState(false);

  const files = React.useMemo(() => splitDiffFiles(values.diff), [values.diff]);
  const paths = [...new Set(files.map((f) => f.path))];
  const previewFiles = files.filter((f) => f.hasHunk).map(({ path, additions, deletions, patch }) => ({
    path,
    additions,
    deletions,
    patch,
  }));
  const range = lineRange(values.startLine, values.endLine);
  const previewRange =
    values.file && range
      ? {
          path: values.file,
          ...range,
          label: t("caseEditor.expectation.expectedLine", { start: range.startLine, end: range.endLine }),
        }
      : undefined;

  const dirty = isDirty(values, initial);
  const mutation = mode === "finding" ? fromFinding : mode === "edit" ? update : create;
  const pending = mutation.isPending;
  const error = mutation.error;

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const requestClose = () => {
    if (dirty) setConfirming(true);
    else onClose();
  };

  // Focus goes back to whatever opened the dialog; read during the first render,
  // before autoFocus moves it.
  const [opener] = React.useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  React.useEffect(() => () => opener?.focus?.(), [opener]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || confirming) return;
      if (dirty) setConfirming(true);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, dirty, onClose]);

  const meta = tryMeta(current, source?.draft);
  const [sent, setSent] = React.useState<string | null>(null);
  const stale = tryCase.data !== undefined && sent !== JSON.stringify(toTryBody(values, meta));
  const sendTry = () => {
    const body = toTryBody(values, meta);
    setSent(JSON.stringify(body));
    tryCase.mutate(body);
  };
  const runCase = () => {
    if (!canRun || !canSave(values) || tryCase.isPending) return;
    sendTry();
  };

  const afterSave = (saved: EvalCase) => {
    if (!runOnSave || !canRun) {
      onClose();
      return;
    }
    setCurrent(saved);
    setInitial(values);
    sendTry();
  };

  const save = () => {
    if (pending || !canSave(values)) return;
    if (current) update.mutate({ id: current.id, body: toUpdateBody(values, initial) }, { onSuccess: afterSave });
    else if (source) {
      fromFinding.mutate(
        { findingId: source.findingId, body: toUpdateBody(values, initial) },
        {
          onSuccess: (saved) => {
            onSaved?.(saved);
            if (saved.created) afterSave(saved.case);
            else onClose();
          },
        },
      );
    } else create.mutate(toCreateBody(values), { onSuccess: afterSave });
  };

  const onDiffChange = (text: string) =>
    setValues((v) => ({
      ...v,
      diff: text,
      file: fileAfterDiffChange(
        v.file,
        splitDiffFiles(text).map((f) => f.path),
      ),
    }));

  const fileOptions = [
    { value: "", label: t("caseEditor.expectation.fileNone") },
    ...withCurrent(paths, values.file).map((p) => ({ value: p, label: p })),
  ];
  const noneOption = { value: "", label: t("caseEditor.expectation.none") };
  const severityOptions = [noneOption, ...withCurrent(SEVERITIES, values.severity).map((v) => ({ value: v, label: v }))];
  const categoryOptions = [noneOption, ...withCurrent(CATEGORIES, values.category).map((v) => ({ value: v, label: v }))];

  const types: Array<{ value: EvalExpectationType; label: string }> = [
    { value: "must_find", label: t("caseEditor.expectation.mustFind") },
    { value: "must_not_flag", label: t("caseEditor.expectation.mustNotFlag") },
  ];

  const last = current?.last_result ?? null;

  return (
    <>
      <Modal
        width={1080}
        title={mode === "edit" && current ? t("caseEditor.caseTitle", { name: current.name }) : t("caseEditor.newCase")}
        subtitle={
          skill
            ? skill.host
              ? t("caseEditor.skillSubtitle", { skill: skill.name, agent: skill.host.name })
              : t("caseEditor.skillSubtitleNoHost", { skill: skill.name })
            : t("caseEditor.subtitle", { agent: agent.name })
        }
        onClose={requestClose}
        footer={
          <div style={s.footer}>
            <Button kind="ghost" onClick={requestClose}>
              {t("caseEditor.cancel")}
            </Button>
            <label style={s.runOnSave}>
              <input type="checkbox" checked={runOnSave} onChange={(e) => setRunOnSave(e.target.checked)} />
              {t("caseEditor.runOnSave")}
            </label>
            <Button
              kind="secondary"
              onClick={runCase}
              disabled={!canRun || !canSave(values) || tryCase.isPending}
              title={t("caseEditor.runCaseTitle")}
              aria-describedby={canRun ? undefined : NO_HOST_ID}
            >
              {tryCase.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
            {!canRun && <span id={NO_HOST_ID}>{t("skillEvals.noHostHint")}</span>}
            <Button kind="primary" icon="Check" onClick={save} disabled={pending || !canSave(values)}>
              {pending ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        }
      >
        <div style={s.grid}>
          <div style={s.col}>
            <Field label={t("caseEditor.nameLabel")} required>
              <TextInput
                value={values.name}
                onChange={(v) => set("name", v)}
                placeholder={t("caseEditor.namePlaceholder")}
                mono
                maxLength={NAME_MAX_LENGTH}
                autoFocus
              />
            </Field>

            <div style={s.inputBox}>
              <h3 style={s.sectionTitle}>{t("caseEditor.inputLabel")}</h3>
              <Tabs
                pad="0"
                value={tab}
                onChange={(k) => setTab(k as InputTab)}
                tabs={[
                  { key: "diff", label: t("caseEditor.tabs.diff") },
                  { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
                ]}
              />
              {tab === "diff" ? (
                <div style={s.tabBody}>
                  {source?.draft.problem && (
                    <div role="status" style={s.notADiff}>
                      {t(
                        source.draft.problem === "file_not_in_diff"
                          ? "caseEditor.problem.fileNotInDiff"
                          : "caseEditor.problem.linesOutsideDiff",
                      )}
                    </div>
                  )}
                  <Field label={t("caseEditor.diffLabel")} required>
                    <Textarea
                      value={values.diff}
                      onChange={onDiffChange}
                      placeholder={t("caseEditor.diffPlaceholder")}
                      rows={10}
                      mono
                    />
                  </Field>
                  <h3 style={s.sectionTitle}>{t("caseEditor.preview")}</h3>
                  {previewFiles.length > 0 ? (
                    <div style={s.previewBox}>
                      <DiffViewer files={previewFiles} range={previewRange} />
                    </div>
                  ) : (
                    values.diff.trim() !== "" && <div style={s.notADiff}>{t("caseEditor.notADiff")}</div>
                  )}
                </div>
              ) : (
                <div style={s.tabBody}>
                  <Field label={t("caseEditor.titleLabel")}>
                    <TextInput
                      value={values.prTitle}
                      onChange={(v) => set("prTitle", v)}
                      placeholder={t("caseEditor.titlePlaceholder")}
                    />
                  </Field>
                  <Field label={t("caseEditor.bodyLabel")}>
                    <Textarea
                      value={values.prBody ?? ""}
                      onChange={(v) => set("prBody", v)}
                      placeholder={t("caseEditor.bodyPlaceholder")}
                      rows={8}
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>

          <div style={s.panel}>
            <h3 style={s.sectionTitle}>{t("caseEditor.expectedOutput")}</h3>

            {mode !== "new" ? (
              <div>
                <span style={s.label}>{t("caseEditor.expectation.typeLabel")}</span>
                <div style={s.typeText}>{types.find((o) => o.value === values.type)?.label}</div>
              </div>
            ) : (
              <fieldset style={s.fieldset}>
                <legend style={s.label}>{t("caseEditor.expectation.typeLabel")}</legend>
                <div style={s.radios}>
                  {types.map((o) => (
                    <label key={o.value} style={s.radio}>
                      <input
                        type="radio"
                        name="expectation-type"
                        value={o.value}
                        checked={values.type === o.value}
                        onChange={() => set("type", o.value)}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <Field label={t("caseEditor.expectation.fileLabel")} required>
              <SelectInput value={values.file} onChange={(v) => set("file", v)} options={fileOptions} />
            </Field>
            <div style={s.pair}>
              <Field label={t("caseEditor.expectation.startLineLabel")} required>
                <TextInput type="number" min={1} mono value={values.startLine} onChange={(v) => set("startLine", v)} />
              </Field>
              <Field label={t("caseEditor.expectation.endLineLabel")} required>
                <TextInput type="number" min={1} mono value={values.endLine} onChange={(v) => set("endLine", v)} />
              </Field>
            </div>
            <Field label={t("caseEditor.expectation.titleLabel")}>
              <TextInput value={values.title} onChange={(v) => set("title", v)} />
            </Field>
            <div style={s.pair}>
              <Field label={t("caseEditor.expectation.severityLabel")}>
                <SelectInput value={values.severity} onChange={(v) => set("severity", v)} options={severityOptions} />
              </Field>
              <Field label={t("caseEditor.expectation.categoryLabel")}>
                <SelectInput value={values.category} onChange={(v) => set("category", v)} options={categoryOptions} />
              </Field>
            </div>

            {last && (
              <div
                role="status"
                style={
                  last.status === "pass"
                    ? s.banner("var(--ok)", "var(--ok-bg)")
                    : last.status === "fail"
                      ? s.banner("var(--crit)", "var(--crit-bg)")
                      : s.banner("var(--warn)", "var(--warn-bg)")
                }
              >
                {last.status === "error" ? (
                  <span>{t("evalsTab.errored", { reason: last.error ?? t("runs.noValue") })}</span>
                ) : (
                  <>
                    <strong style={s.bannerStrong(last.status === "pass" ? "var(--ok)" : "var(--crit)")}>
                      {last.status === "pass" ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
                    </strong>
                    <span>
                      {t("evalsTab.expectedGot", { expected: expectedCount(values.type), got: last.matched })}
                    </span>
                  </>
                )}
              </div>
            )}

            <TryResult
              result={tryCase.data ?? null}
              error={tryCase.error}
              expectationType={values.type}
              stale={stale}
            />

            {error && (
              <div role="alert" style={s.error}>
                {error.message}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {confirming && (
        <ConfirmDialog
          title={t("caseEditor.discard.title")}
          body={t("caseEditor.discard.body")}
          confirmLabel={t("caseEditor.discard.confirm")}
          cancelLabel={t("caseEditor.discard.keep")}
          onConfirm={onClose}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
