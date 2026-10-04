"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { GRAPH_NODE_HEIGHT, GRAPH_NODE_KINDS, GRAPH_NODE_WIDTH, NODE_STYLE } from "../../constants";
import { buildBlastGraph } from "../../helpers";
import { legendDot, s } from "../../styles";

export function BlastGraph({ data }: { data: BlastRadiusResponse }) {
  const t = useTranslations("blast");
  const graph = buildBlastGraph(data);

  if (graph.nodes.length === 0) return <p style={s.muted}>{t("graph.empty")}</p>;

  const hasCron = graph.nodes.some((node) => node.kind === "cron");
  const legendKinds = GRAPH_NODE_KINDS.filter((kind) => kind !== "cron" || hasCron);

  return (
    <div>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        viewBox={`0 0 ${graph.width} ${graph.height}`}
        width="100%"
        style={s.graph}
      >
        {graph.edges.map((edge) => (
          <path key={edge.id} d={edge.d} fill="none" stroke="var(--border-strong)" />
        ))}
        {graph.nodes.map((node) => {
          const look = NODE_STYLE[node.kind];
          return (
            <g key={node.id}>
              <title>{node.title}</title>
              <rect
                x={node.x}
                y={node.y}
                width={GRAPH_NODE_WIDTH}
                height={GRAPH_NODE_HEIGHT}
                rx={6}
                fill="var(--bg-surface)"
                stroke={look.stroke}
              />
              <text
                className="mono"
                x={node.x + GRAPH_NODE_WIDTH / 2}
                y={node.y + GRAPH_NODE_HEIGHT / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={look.text}
                style={s.graphText}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div style={s.legend}>
        {legendKinds.map((kind) => (
          <span key={kind} style={s.legendItem}>
            <span aria-hidden style={legendDot(NODE_STYLE[kind].stroke)} />
            {t(`graph.legend.${kind}`)}
          </span>
        ))}
      </div>
      {graph.hiddenCount > 0 && <p style={s.note}>{t("graph.truncated", { count: graph.hiddenCount })}</p>}
    </div>
  );
}
