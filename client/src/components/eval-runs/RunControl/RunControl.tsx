"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useEvalRuns, useStartEvalRun } from "@/lib/hooks/evals";
import { EVAL_NO_HOST_HINT_ID, skillOwner, type SkillEvalTarget } from "../helpers";

const s = {
  wrap: { display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  error: { fontSize: 13, color: "var(--crit)" },
  live: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
} as const satisfies Record<string, React.CSSProperties>;

/**
 * Starts an eval run of one agent. The newest run in the list decides whether
 * a run is going (it also covers a run started in another tab or before a
 * reload); a refusal or a failed run is shown as text with the button enabled.
 */
export function RunControl({
  agentId,
  skill,
  caseCount,
  variant,
}: (
  | { agentId: string; skill?: undefined }
  | { skill: SkillEvalTarget; agentId?: undefined }
) & {
  caseCount: number;
  variant: "all" | "one";
}) {
  const t = useTranslations("eval");
  const owner = skill ? skillOwner(skill) : agentId;
  const { data: runs } = useEvalRuns(owner);
  const start = useStartEvalRun(owner);
  const noHost = skill !== undefined && skill.host === null;
  const newest = runs?.[0];
  const running = newest?.status === "running";

  const announced = useAnnouncement(newest);
  const failure =
    start.error?.message ?? (newest?.status === "failed" ? (newest.error ?? t("runs.noValue")) : null);

  const label = running
    ? t("runs.runningLabel")
    : variant === "all"
      ? t("runs.runAll", { count: caseCount })
      : t("dashboard.runEval", { count: caseCount });

  return (
    <div style={s.wrap}>
      <Button
        kind={variant === "all" ? "secondary" : "primary"}
        size="sm"
        icon="Play"
        loading={running || start.isPending}
        disabled={caseCount === 0 || noHost || running || start.isPending}
        aria-describedby={noHost ? EVAL_NO_HOST_HINT_ID : undefined}
        title={
          skill?.host ? t("skillEvals.runAllTitle", { count: caseCount, agent: skill.host.name }) : undefined
        }
        onClick={() => start.mutate()}
      >
        {label}
      </Button>
      {failure !== null && (
        <span role="alert" style={s.error}>
          {failure}
        </span>
      )}
      <span role="status" style={s.live}>
        {announced}
      </span>
    </div>
  );
}

type Seen = { id: string; status: "running" | "done" | "failed" };

/** Text for the live region: set when the newest run starts or settles, so a screen reader hears the change. */
function useAnnouncement(
  newest: { id: string; status: Seen["status"]; error: string | null } | undefined,
): string {
  const t = useTranslations("eval");
  const [message, setMessage] = React.useState("");
  const previous = React.useRef<Seen | null>(null);

  React.useEffect(() => {
    const before = previous.current;
    previous.current = newest ? { id: newest.id, status: newest.status } : null;
    if (!newest) return;
    if (newest.status === "running" && (before?.id !== newest.id || before.status !== "running")) {
      setMessage(t("runs.status.started"));
    } else if (before?.id === newest.id && before.status === "running" && newest.status === "done") {
      setMessage(t("runs.status.done"));
    } else if (before?.id === newest.id && before.status === "running" && newest.status === "failed") {
      setMessage(t("runs.status.failed", { error: newest.error ?? t("runs.noValue") }));
    }
  }, [newest, t]);

  return message;
}
