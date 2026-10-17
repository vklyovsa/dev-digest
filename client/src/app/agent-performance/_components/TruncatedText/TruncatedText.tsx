"use client";

import React from "react";

export function TruncatedText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <span
      title={text}
      tabIndex={0}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
      style={{
        display: "block",
        minWidth: 0,
        overflow: expanded ? "visible" : "hidden",
        textOverflow: "ellipsis",
        whiteSpace: expanded ? "normal" : "nowrap",
        overflowWrap: expanded ? "anywhere" : undefined,
        ...style,
      }}
    >
      {text}
    </span>
  );
}
