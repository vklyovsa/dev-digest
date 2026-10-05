"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { DocumentContent, splitDocPath } from "@/components/project-context";
import { useContextDocument } from "@/lib/hooks/core";
import { s } from "./styles";

interface DocumentPaneProps {
  repoId: string;
  doc: SpecFile | null;
}

export function DocumentPane({ repoId, doc }: DocumentPaneProps) {
  const t = useTranslations("context");
  const content = useContextDocument(repoId, doc?.path);

  if (!doc) return <section style={s.pane} />;

  let body: React.ReactNode = null;
  if (content.isLoading) {
    body = (
      <div style={s.skeletons}>
        <Skeleton height={28} width="45%" />
        <Skeleton height={14} />
        <Skeleton height={14} width="80%" />
      </div>
    );
  } else if (content.isError) {
    body = <ErrorState title={t("page.documentError")} />;
  } else if (content.data) {
    body = <DocumentContent content={content.data.content} />;
  }

  return (
    <section style={s.pane}>
      <header style={s.header}>
        <h2 className="mono" title={doc.path} style={s.name}>
          {splitDocPath(doc.path).name}
        </h2>
        <span style={s.usedBy}>
          <Icon.Cpu size={14} />
          {t("page.usedBy", { count: doc.agent_count })}
        </span>
      </header>
      <div style={s.body}>{body}</div>
    </section>
  );
}
