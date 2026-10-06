"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Skeleton } from "@devdigest/ui";
import { useContextDocument } from "@/lib/hooks/core";
import { DocumentContent } from "../DocumentContent";

const BODY: React.CSSProperties = { padding: "20px 24px", fontSize: 14 };
const SKELETONS: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const ERROR: React.CSSProperties = { fontSize: 13, color: "var(--crit)" };

interface PreviewDialogProps {
  repoId: string;
  path: string;
  onClose: () => void;
}

/** One document's rendered text and token estimate; its text is requested only while the dialog is open. */
export function PreviewDialog({ repoId, path, onClose }: PreviewDialogProps) {
  const t = useTranslations("context");
  const doc = useContextDocument(repoId, path);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  let body: React.ReactNode = null;
  if (doc.isLoading) {
    body = (
      <div style={SKELETONS}>
        <Skeleton height={26} width="45%" />
        <Skeleton height={14} />
        <Skeleton height={14} width="80%" />
      </div>
    );
  } else if (doc.isError) {
    body = (
      <p role="alert" style={ERROR}>
        {t("attach.loadError")}
      </p>
    );
  } else if (doc.data) {
    body = <DocumentContent content={doc.data.content} />;
  }

  return (
    <Modal
      width={900}
      title={<span className="mono">{path}</span>}
      subtitle={doc.data ? t("attach.tokens", { count: doc.data.tokens }) : undefined}
      onClose={onClose}
    >
      <div style={BODY}>{body}</div>
    </Modal>
  );
}
