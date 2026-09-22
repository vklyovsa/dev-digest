/* SkillsView — /skills: the skill list on the left, the selected skill's editor
   on the right. Selection and tab live in the query string (?skill=&tab=) so a
   link to "this skill, this tab" is shareable and survives a reload. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { SkillsList } from "../SkillsList";
import { SkillDetail } from "../SkillDetail";
import { AddSkillDrawer } from "../AddSkillDrawer";
import { CreateSkillModal } from "../CreateSkillModal";
import { SKILL_TAB_KEYS } from "../../constants";
import { s } from "./styles";

export function SkillsView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const params = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();

  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [importTab, setImportTab] = React.useState<"file" | "community" | null>(null);

  const list = skills ?? [];
  const requestedId = params.get("skill");
  // A deleted (or unknown) id must not leave the pane stuck on a ghost.
  const selected = list.find((sk) => sk.id === requestedId) ?? null;
  const tabParam = params.get("tab") ?? "";
  const tab = SKILL_TAB_KEYS.includes(tabParam) ? tabParam : "config";

  const navigate = (skillId: string | null, nextTab: string = tab) => {
    const sp = new URLSearchParams();
    if (skillId) {
      sp.set("skill", skillId);
      sp.set("tab", nextTab);
    }
    const qs = sp.toString();
    router.replace(qs ? `/skills?${qs}` : "/skills");
  };

  const toggle = (skill: Skill, enabled: boolean) =>
    update.mutate({ id: skill.id, patch: { enabled } });

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {creating && (
        <CreateSkillModal
          onClose={() => setCreating(false)}
          onCreated={(skill) => navigate(skill.id, "config")}
        />
      )}
      {importTab && (
        <AddSkillDrawer
          initialTab={importTab}
          onClose={() => setImportTab(null)}
          onImported={(skill) => navigate(skill.id, "config")}
        />
      )}

      <div style={s.page}>
        <SkillsList
          skills={list}
          selectedId={selected?.id ?? null}
          isLoading={isLoading}
          isError={isError}
          search={search}
          onSearch={setSearch}
          onSelect={(id) => navigate(id)}
          onToggle={toggle}
          onCreate={() => setCreating(true)}
          onImportFile={() => setImportTab("file")}
          onImportCommunity={() => setImportTab("community")}
          onRetry={() => refetch()}
        />

        {selected ? (
          <SkillDetail
            skill={selected}
            tab={tab}
            onTab={(next) => navigate(selected.id, next)}
            onDeleted={() => navigate(null)}
          />
        ) : (
          <div style={s.placeholder}>
            <EmptyState
              icon="Sparkles"
              title={t("page.selectPrompt.title")}
              body={t("page.selectPrompt.body")}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
