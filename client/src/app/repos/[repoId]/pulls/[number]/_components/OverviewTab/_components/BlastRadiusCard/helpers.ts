import type { BlastDegradedReason, BlastRadiusResponse, ChangedSymbol } from "@devdigest/shared";
import {
  GRAPH_LABEL_MAX_CHARS,
  GRAPH_MAX_CALLERS,
  GRAPH_MAX_FACTS,
  GRAPH_MAX_SYMBOLS,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  GRAPH_PADDING,
  GRAPH_ROW_GAP,
  GRAPH_WIDTH,
  type GraphNodeKind,
} from "./constants";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  title: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  d: string;
}

export interface BlastGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  hiddenCount: number;
}

type PendingNode = Omit<GraphNode, "x" | "y">;

export function symbolLabel(name: string, kind: string | undefined): string {
  return kind === "function" || kind === "method" ? `${name}()` : name;
}

export function kindBySymbol(changed: ChangedSymbol[]): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const symbol of changed) {
    if (!kinds.has(symbol.name)) kinds.set(symbol.name, symbol.kind);
  }
  return kinds;
}

export function countSymbolsWithoutCallers(data: BlastRadiusResponse): number {
  const withCallers = new Set(data.downstream.map((group) => group.symbol));
  return data.changed_symbols.filter((symbol) => !withCallers.has(symbol.name)).length;
}

export function degradedReasonKey(reason: BlastDegradedReason | null): string {
  return reason ?? "unknown";
}

export function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

export function truncateLabel(text: string): string {
  return text.length > GRAPH_LABEL_MAX_CHARS ? `${text.slice(0, GRAPH_LABEL_MAX_CHARS - 1)}…` : text;
}

function placeColumn(items: PendingNode[], x: number, height: number): GraphNode[] {
  const step = GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP;
  const columnHeight = items.length === 0 ? 0 : items.length * step - GRAPH_ROW_GAP;
  const top = (height - columnHeight) / 2;
  return items.map((item, i) => ({ ...item, x, y: top + i * step }));
}

function edgePath(from: GraphNode, to: GraphNode): string {
  const x1 = from.x + GRAPH_NODE_WIDTH;
  const y1 = from.y + GRAPH_NODE_HEIGHT / 2;
  const x2 = to.x;
  const y2 = to.y + GRAPH_NODE_HEIGHT / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export function buildBlastGraph(data: BlastRadiusResponse): BlastGraph {
  const kinds = kindBySymbol(data.changed_symbols);
  const groups = data.downstream.slice(0, GRAPH_MAX_SYMBOLS);

  const callerByKey = new Map<string, { name: string; file: string; line: number }>();
  for (const group of groups) {
    for (const caller of group.callers) {
      const key = `c:${caller.file}#${caller.name}`;
      if (!callerByKey.has(key)) callerByKey.set(key, caller);
    }
  }
  const callerEntries = [...callerByKey.entries()];
  const shownCallers = callerEntries.slice(0, GRAPH_MAX_CALLERS);
  const shownCallerKeys = new Set(shownCallers.map(([key]) => key));
  const shownFiles = new Set(shownCallers.map(([, caller]) => caller.file));

  const factsByFile = new Map(data.caller_file_facts.map((facts) => [facts.file, facts]));
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  for (const facts of data.caller_file_facts) {
    if (!shownFiles.has(facts.file)) continue;
    facts.endpoints.forEach((value) => endpoints.add(value));
    facts.crons.forEach((value) => crons.add(value));
  }
  const factEntries: PendingNode[] = [
    ...[...endpoints].map((value): PendingNode => ({ id: `e:${value}`, kind: "endpoint", label: truncateLabel(value), title: value })),
    ...[...crons].map((value): PendingNode => ({ id: `k:${value}`, kind: "cron", label: truncateLabel(value), title: value })),
  ];
  const shownFacts = factEntries.slice(0, GRAPH_MAX_FACTS);
  const shownFactIds = new Set(shownFacts.map((fact) => fact.id));

  const symbolColumn: PendingNode[] = groups.map((group) => {
    const label = symbolLabel(group.symbol, kinds.get(group.symbol));
    return { id: `s:${group.symbol}`, kind: "symbol", label: truncateLabel(label), title: label };
  });
  const callerColumn: PendingNode[] = shownCallers.map(([key, caller]) => ({
    id: key,
    kind: "caller",
    label: truncateLabel(caller.name),
    title: `${caller.file}:${caller.line}`,
  }));

  const rows = Math.max(1, symbolColumn.length, callerColumn.length, shownFacts.length);
  const height = 2 * GRAPH_PADDING + rows * GRAPH_NODE_HEIGHT + (rows - 1) * GRAPH_ROW_GAP;
  const xs = [
    GRAPH_PADDING,
    (GRAPH_WIDTH - GRAPH_NODE_WIDTH) / 2,
    GRAPH_WIDTH - GRAPH_PADDING - GRAPH_NODE_WIDTH,
  ] as const;
  const nodes = [
    ...placeColumn(symbolColumn, xs[0], height),
    ...placeColumn(callerColumn, xs[1], height),
    ...placeColumn(shownFacts, xs[2], height),
  ];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const edges = new Map<string, GraphEdge>();
  const connect = (fromId: string, toId: string) => {
    const from = nodeById.get(fromId);
    const to = nodeById.get(toId);
    const id = `${fromId}->${toId}`;
    if (from && to && !edges.has(id)) edges.set(id, { id, d: edgePath(from, to) });
  };
  for (const group of groups) {
    for (const caller of group.callers) {
      const key = `c:${caller.file}#${caller.name}`;
      if (shownCallerKeys.has(key)) connect(`s:${group.symbol}`, key);
    }
  }
  for (const [key, caller] of shownCallers) {
    const facts = factsByFile.get(caller.file);
    if (!facts) continue;
    for (const value of facts.endpoints) {
      if (shownFactIds.has(`e:${value}`)) connect(key, `e:${value}`);
    }
    for (const value of facts.crons) {
      if (shownFactIds.has(`k:${value}`)) connect(key, `k:${value}`);
    }
  }

  const hiddenCount =
    data.downstream.length - groups.length +
    (callerEntries.length - shownCallers.length) +
    (factEntries.length - shownFacts.length);

  return { nodes, edges: [...edges.values()], width: GRAPH_WIDTH, height, hiddenCount };
}
