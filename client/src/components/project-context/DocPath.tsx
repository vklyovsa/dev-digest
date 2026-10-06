import React from "react";
import { splitDocPath } from "./helpers";

const WRAP: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  minWidth: 0,
};
const NAME: React.CSSProperties = { flexShrink: 0, fontSize: 13, color: "var(--text-primary)" };
const FOLDER: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  color: "var(--text-muted)",
};

/** A document's path as file name plus folder: a narrow row cuts the folder, never the name. */
export function DocPath({ path }: { path: string }) {
  const { name, folder } = splitDocPath(path);
  return (
    <span title={path} style={WRAP}>
      <span className="mono" style={NAME}>
        {name}
      </span>
      {folder && (
        <span className="mono" style={FOLDER}>
          {folder}
        </span>
      )}
    </span>
  );
}

export default DocPath;
