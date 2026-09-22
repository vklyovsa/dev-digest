/* VersionsTab — the skill's body history. Restoring does NOT rewind: it writes
   the old body as a new version, so a run that cited v3 keeps meaning v3. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { approxTokens } from "@/lib/tokens";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();

  const onRestore = (version: number) =>
    restore.mutate(
      { id: skill.id, version },
      {
        onSuccess: (data) =>
          toast.success(t("versions.restoredToast", { version, newVersion: data.version })),
      },
    );

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={s.header}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{t("versions.title")}</h2>
        <Badge color="var(--text-muted)">
          {t("versions.count", { count: versions?.length ?? 0 })}
        </Badge>
      </div>
      <p style={s.subtitle}>{t("versions.subtitle")}</p>

      {isLoading && <Skeleton height={64} />}
      {(versions ?? []).map((v) => {
        const current = v.version === skill.version;
        return (
          <Card key={v.version} style={s.row}>
            <span className="mono" style={s.versionChip}>
              v{v.version}
            </span>
            <div style={s.rowText}>
              <div style={s.note}>{v.note || t("versions.noNote")}</div>
              <div style={s.meta}>
                {new Date(v.created_at).toLocaleDateString()} ·{" "}
                {t("config.tokens", { count: approxTokens(v.body) })}
              </div>
            </div>
            {current ? (
              <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
                {t("versions.current")}
              </Badge>
            ) : (
              <Button
                kind="secondary"
                size="sm"
                icon="History"
                disabled={restore.isPending}
                onClick={() => onRestore(v.version)}
              >
                {restore.isPending && restore.variables?.version === v.version
                  ? t("versions.restoring")
                  : t("versions.restore")}
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}
