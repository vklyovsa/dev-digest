"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, IconBtn, type IconName } from "@devdigest/ui";
import { DocPath } from "../DocPath";
import { DocTypeBadge } from "../DocTypeBadge";
import type { AttachmentRowData } from "./helpers";
import { s } from "./styles";

export interface RowActions {
  toggle: (path: string) => void;
  /** Move an attached path by `by` positions in the attachment list. */
  move: (path: string, by: number) => void;
  preview: (path: string) => void;
  dragStart: (path: string) => void;
  drop: (path: string) => void;
  dragEnd: () => void;
}

interface AttachmentRowProps {
  row: AttachmentRowData;
  /** How many documents the owner has attached; the last attached row cannot move later. */
  attachedCount: number;
  disabled: boolean;
  /** A labelled button on the agent tab, an icon button on the skill tab. */
  preview: "button" | "icon";
  actions: RowActions;
}

function MoveButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const I = Icon[icon];
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={s.moveBtn(disabled)}
    >
      <I size={13} />
    </button>
  );
}

/**
 * One document of the Context tab. An own attached row has a checkbox, a drag handle and
 * move buttons; an inherited row is read-only and names its skill; a path the repository
 * no longer lists is marked as such and keeps its checkbox so it can be detached.
 */
export function AttachmentRow({ row, attachedCount, disabled, preview, actions }: AttachmentRowProps) {
  const t = useTranslations("context");
  const { path, source, type, missing, skillName, index } = row;
  const attached = source === "attached";
  const draggable = attached && !disabled;
  const previewLabel = t("attach.previewOf", { path });

  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer?.setData("text/plain", path);
        actions.dragStart(path);
      }}
      onDragOver={(e) => attached && e.preventDefault()}
      onDrop={() => attached && actions.drop(path)}
      onDragEnd={actions.dragEnd}
      style={s.row(attached)}
    >
      <span style={s.handle(attached)} aria-hidden>
        <Icon.Menu size={13} />
      </span>
      {source === "inherited" ? (
        <span style={s.checkboxGap} aria-hidden />
      ) : (
        <input
          type="checkbox"
          checked={attached}
          disabled={disabled}
          onChange={() => actions.toggle(path)}
          aria-label={t("attach.toggle", { path })}
          style={s.checkbox}
        />
      )}
      <span style={s.path}>
        <DocPath path={path} />
      </span>
      <span style={s.trailing}>
        {source === "inherited" && <span style={s.via}>{t("attach.via", { skill: skillName ?? "" })}</span>}
        {attached && (
          <>
            <MoveButton
              icon="ArrowUp"
              label={t("attach.moveEarlier", { path })}
              disabled={disabled || index === 0}
              onClick={() => actions.move(path, -1)}
            />
            <MoveButton
              icon="ArrowDown"
              label={t("attach.moveLater", { path })}
              disabled={disabled || index === attachedCount - 1}
              onClick={() => actions.move(path, 1)}
            />
          </>
        )}
        {type === null ? <span style={s.missing}>{t("attach.notFound")}</span> : <DocTypeBadge type={type} />}
        {!missing &&
          (preview === "button" ? (
            <Button
              type="button"
              kind="ghost"
              size="sm"
              icon="Eye"
              aria-label={previewLabel}
              onClick={() => actions.preview(path)}
            >
              {t("attach.preview")}
            </Button>
          ) : (
            <IconBtn icon="Eye" label={previewLabel} onClick={() => actions.preview(path)} />
          ))}
      </span>
    </li>
  );
}
