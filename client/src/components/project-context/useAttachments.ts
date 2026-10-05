"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ContextInheritedDoc, SpecFile } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useContextFiles } from "@/lib/hooks/core";
import { useAgentContext, useSetAgentContext } from "@/lib/hooks/agents";
import { useSkillContext, useSetSkillContext } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";

export interface AttachmentOwner {
  kind: "agent" | "skill";
  id: string;
}

export interface AttachmentState {
  repoId: string | null;
  /** `loading` until the repository list is known; `none` when no repository is active. */
  repoState: "loading" | "none" | "ready";
  documents: SpecFile[];
  roots: string[];
  /** The owner's own attached paths, in attachment order. */
  paths: string[];
  /** Documents the owner's skills bring; always empty for a skill. */
  inherited: ContextInheritedDoc[];
  /** The document list or the attachment list is not here yet. */
  loading: boolean;
  failed: boolean;
  retry: () => void;
  /** Replace the owner's whole ordered attachment list. */
  commit: (nextPaths: string[]) => void;
}

const NO_DOCUMENTS: SpecFile[] = [];
const NO_ROOTS: string[] = [];
const NO_PATHS: string[] = [];
const NO_INHERITED: ContextInheritedDoc[] = [];

/**
 * Everything one Context tab needs: the active repository's documents, the owner's
 * attachment list, and a `commit` that saves a whole new list. The server and the query
 * cache own the data; `pending` is only the list shown while a save is in flight.
 */
export function useAttachments(owner: AttachmentOwner): AttachmentState {
  const t = useTranslations("context");
  const toast = useToast();
  const { activeRepo, reposLoaded } = useActiveRepo();
  const repoState = activeRepo ? "ready" : reposLoaded ? "none" : "loading";
  const repoId = activeRepo?.id ?? null;

  const files = useContextFiles(repoId, repoState === "ready");
  const agentContext = useAgentContext(owner.kind === "agent" ? owner.id : null);
  const skillContext = useSkillContext(owner.kind === "skill" ? owner.id : null);
  const attachments = owner.kind === "agent" ? agentContext : skillContext;
  const saveAgent = useSetAgentContext();
  const saveSkill = useSetSkillContext();

  // A click before the list has loaded would send a one-element array to a full-replace
  // endpoint, so every control stays disabled until `attachments` has arrived.
  const [pending, setPending] = React.useState<string[] | null>(null);
  const inFlight = React.useRef(0);

  const commit = (nextPaths: string[]) => {
    setPending(nextPaths);
    inFlight.current += 1;
    const request =
      owner.kind === "agent"
        ? saveAgent.mutateAsync({ agentId: owner.id, paths: nextPaths })
        : saveSkill.mutateAsync({ skillId: owner.id, paths: nextPaths });
    request
      .catch(() => {
        setPending(null);
        toast.error(t("attach.saveError"));
      })
      .finally(() => {
        inFlight.current -= 1;
        if (inFlight.current === 0) setPending(null);
      });
  };

  const retry = () => {
    if (files.isError) void files.refetch();
    if (attachments.isError) void attachments.refetch();
  };

  return {
    repoId,
    repoState,
    documents: files.data?.documents ?? NO_DOCUMENTS,
    roots: files.data?.roots ?? NO_ROOTS,
    paths: pending ?? attachments.data?.paths ?? NO_PATHS,
    inherited: attachments.data?.inherited ?? NO_INHERITED,
    loading:
      repoState === "loading" || (repoState === "ready" && files.isPending) || attachments.isPending,
    failed: (files.isError && !files.data) || (attachments.isError && !attachments.data),
    retry,
    commit,
  };
}
