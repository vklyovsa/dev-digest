"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { BlastDegradedReason } from "@devdigest/shared";
import { useBlastResync } from "@/lib/hooks/blast";
import { degradedReasonKey } from "../../helpers";
import { s } from "../../styles";

interface DegradedNoticeProps {
  reason: BlastDegradedReason | null;
  repoId: string;
  prId: string;
}

export function DegradedNotice({ reason, repoId, prId }: DegradedNoticeProps) {
  const t = useTranslations("blast");
  const resync = useBlastResync(repoId, prId);

  return (
    <div style={s.degraded}>
      <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
        {t("degraded.badge")}
      </Badge>
      <span style={s.degradedText}>{t(`degraded.reason.${degradedReasonKey(reason)}`)}</span>
      <Button
        kind="ghost"
        size="sm"
        icon="RefreshCw"
        loading={resync.isRunning}
        disabled={!resync.ready}
        onClick={resync.start}
      >
        {resync.isRunning ? t("resync.running") : t("resync.action")}
      </Button>
      {resync.timedOut && (
        <div role="status" style={s.degradedNote}>
          {t("resync.timeout")}
        </div>
      )}
    </div>
  );
}
