import React from "react";
import { Markdown } from "@devdigest/ui";

/** A document's text rendered as Markdown; `.dd-doc` restores heading sizes and list markers. */
export function DocumentContent({ content }: { content: string }) {
  return (
    <div className="dd-doc">
      <Markdown>{content}</Markdown>
    </div>
  );
}

export default DocumentContent;
