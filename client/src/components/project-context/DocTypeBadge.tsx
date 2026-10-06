import React from "react";
import { Badge } from "@devdigest/ui";
import { docTypeColors } from "./helpers";

/** A document's type as a badge: its own text, coloured when it is one of the default roots. */
export function DocTypeBadge({ type }: { type: string }) {
  const { color, bg } = docTypeColors(type);
  return (
    <Badge color={color} bg={bg}>
      {type}
    </Badge>
  );
}

export default DocTypeBadge;
