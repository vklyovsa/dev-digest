"use client";

import React from "react";
import { cs } from "../comments";
import type { DiffFindingsApi } from "../findings";
import type { FindingRecord } from "@devdigest/shared";

export function OutsideFindings({
  findings,
  api,
}: {
  findings: FindingRecord[];
  api: DiffFindingsApi;
}) {
  if (findings.length === 0) return null;
  return (
    <div style={cs.outdatedWrap}>
      <span style={cs.outdatedTitle}>{api.labels.outside(findings.length)}</span>
      {findings.map((f) => (
        <div key={f.id}>{api.renderFinding(f)}</div>
      ))}
    </div>
  );
}
