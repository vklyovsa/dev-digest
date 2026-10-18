/* RunReviewDropdown — ported from components2.jsx.
   Pick agents, then start ONE multi-agent run (POST /pulls/:id/multi-agent-run)
   and open its results page. Hands the child run ids up so the parent can
   stream SSE live status. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { repoId } = useParams<{ repoId: string }>();
  const { data: agents } = useAgents();
  const start = useStartMultiAgentRun();
  const all = agents ?? [];
  const [open, setOpen] = React.useState(false);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const initialised = React.useRef(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (initialised.current || !agents) return;
    initialised.current = true;
    setChecked(new Set(agents.filter((a) => a.enabled).map((a) => a.id)));
  }, [agents]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (id: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const count = checked.size;
  const runLabel =
    count === 0 ? t("runReview.selectAgents") : count === 1 ? t("runReview.runOne") : t("runReview.runMany", { count });

  const run = async () => {
    onRunStart?.();
    try {
      const res = await start.mutateAsync({ prId, agentIds: [...checked] });
      onRunsStarted?.(res.columns.map((c) => c.run_id));
      setOpen(false);
      router.push(`/repos/${repoId}/multi-agent/${res.id}`);
    } finally {
      onRunSettled?.();
    }
  };

  return (
    <div ref={rootRef} style={s.root}>
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind={kind}
          size={size}
          iconRight="ChevronDown"
          icon="Sparkles"
          loading={start.isPending}
          onClick={() => setOpen((o) => !o)}
        >
          {start.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>
      {open && (
        <div style={s.panel}>
          {warnMerged && <div style={s.warning}>{t("runReview.mergedWarning")}</div>}
          {all.length === 0 ? (
            <button type="button" style={s.link} onClick={() => router.push("/agents")}>
              {t("runReview.noAgents")}
            </button>
          ) : (
            all.map((a) => (
              <div key={a.id} style={s.agentRow}>
                <Checkbox checked={checked.has(a.id)} onChange={(v) => toggle(a.id, v)} label={a.name} />
                <span style={s.hint}>
                  {a.enabled ? a.model : t("runReview.disabledHint", { model: a.model })}
                </span>
              </div>
            ))
          )}
          <Button kind="primary" size="sm" icon="Users" disabled={count === 0 || start.isPending} onClick={run}>
            {runLabel}
          </Button>
          <button type="button" style={s.link} onClick={() => router.push("/agents")}>
            {t("runReview.configureAgents")}
          </button>
        </div>
      )}
    </div>
  );
}
