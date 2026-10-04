import { describe, it, expect } from "vitest";
import type { BlastRadiusResponse } from "@devdigest/shared";
import blast from "../../../../../../../../../../messages/en/blast.json";
import {
  DEGRADED_REASONS,
  GRAPH_LABEL_MAX_CHARS,
  GRAPH_MAX_CALLERS,
  GRAPH_MAX_FACTS,
  GRAPH_MAX_SYMBOLS,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  GRAPH_PADDING,
  GRAPH_ROW_GAP,
  GRAPH_WIDTH,
  HISTORY_UNAVAILABLE_REASONS,
} from "./constants";
import {
  buildBlastGraph,
  countSymbolsWithoutCallers,
  degradedReasonKey,
  isoDay,
  kindBySymbol,
  symbolLabel,
  truncateLabel,
} from "./helpers";

type Group = BlastRadiusResponse["downstream"][number];

const caller = (name: string, file: string, line = 1) => ({ name, file, line });
const group = (symbol: string, callers: Group["callers"]): Group => ({
  symbol,
  callers,
  endpoints_affected: [],
  crons_affected: [],
});

function mapOf(downstream: Group[], facts: BlastRadiusResponse["caller_file_facts"] = []): BlastRadiusResponse {
  return {
    changed_symbols: downstream.map((g) => ({ name: g.symbol, file: "src/lib.ts", kind: "function" })),
    downstream,
    summary: "",
    totals: { symbols: downstream.length, callers: 0, endpoints: 0, crons: 0 },
    degraded: false,
    reason: null,
    max_callers_per_symbol: 20,
    indexed_sha: null,
    changed_files_count: 1,
    caller_file_facts: facts,
  };
}

const ids = (nodes: { id: string }[]) => nodes.map((n) => n.id);

describe("buildBlastGraph", () => {
  const data = mapOf(
    [
      group("alpha", [caller("one", "src/f1.ts", 10), caller("shared", "src/f2.ts", 20)]),
      group("beta", [caller("shared", "src/f2.ts", 20)]),
    ],
    [
      { file: "src/f1.ts", endpoints: ["GET /one"], crons: [] },
      { file: "src/f2.ts", endpoints: ["GET /one", "POST /two"], crons: ["0 * * * *"] },
    ],
  );

  it("lays symbols, callers and facts out in three columns, endpoints before crons", () => {
    const graph = buildBlastGraph(data);

    expect(ids(graph.nodes)).toEqual([
      "s:alpha",
      "s:beta",
      "c:src/f1.ts#one",
      "c:src/f2.ts#shared",
      "e:GET /one",
      "e:POST /two",
      "k:0 * * * *",
    ]);
    expect(graph.nodes.map((n) => n.kind)).toEqual([
      "symbol",
      "symbol",
      "caller",
      "caller",
      "endpoint",
      "endpoint",
      "cron",
    ]);

    const [symbolX, callerX, factX] = [
      GRAPH_PADDING,
      (GRAPH_WIDTH - GRAPH_NODE_WIDTH) / 2,
      GRAPH_WIDTH - GRAPH_PADDING - GRAPH_NODE_WIDTH,
    ];
    expect(graph.nodes.map((n) => n.x)).toEqual([symbolX, symbolX, callerX, callerX, factX, factX, factX]);

    const rows = 3;
    expect(graph.width).toBe(GRAPH_WIDTH);
    expect(graph.height).toBe(2 * GRAPH_PADDING + rows * GRAPH_NODE_HEIGHT + (rows - 1) * GRAPH_ROW_GAP);
    expect(graph.hiddenCount).toBe(0);
  });

  it("draws a caller reaching two symbols once, with one edge from each", () => {
    const graph = buildBlastGraph(data);

    expect(graph.nodes.filter((n) => n.id === "c:src/f2.ts#shared")).toHaveLength(1);
    expect(ids(graph.edges)).toEqual([
      "s:alpha->c:src/f1.ts#one",
      "s:alpha->c:src/f2.ts#shared",
      "s:beta->c:src/f2.ts#shared",
      "c:src/f1.ts#one->e:GET /one",
      "c:src/f2.ts#shared->e:GET /one",
      "c:src/f2.ts#shared->e:POST /two",
      "c:src/f2.ts#shared->k:0 * * * *",
    ]);
  });

  it("joins the right edge of a node to the left edge of the next column with a curve", () => {
    const graph = buildBlastGraph(mapOf([group("alpha", [caller("one", "src/f1.ts")])]));
    const [from, to] = graph.nodes;
    const x1 = from!.x + GRAPH_NODE_WIDTH;
    const y1 = from!.y + GRAPH_NODE_HEIGHT / 2;
    const mx = (x1 + to!.x) / 2;

    expect(graph.edges).toEqual([
      { id: "s:alpha->c:src/f1.ts#one", d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${to!.y + GRAPH_NODE_HEIGHT / 2}, ${to!.x} ${to!.y + GRAPH_NODE_HEIGHT / 2}` },
    ]);
  });

  it("labels function symbols with parentheses and shortens long labels, keeping the full text as the title", () => {
    const longName = "a".repeat(GRAPH_LABEL_MAX_CHARS + 8);
    const graph = buildBlastGraph(mapOf([group(longName, [caller("one", "src/f1.ts", 7)])]));

    const [symbol, callerNode] = graph.nodes;
    expect(symbol!.label).toHaveLength(GRAPH_LABEL_MAX_CHARS);
    expect(symbol!.label.endsWith("…")).toBe(true);
    expect(symbol!.title).toBe(`${longName}()`);
    expect(callerNode!.title).toBe("src/f1.ts:7");
  });

  it("caps symbols, callers and facts, and counts everything it left out", () => {
    const manySymbols = Array.from({ length: GRAPH_MAX_SYMBOLS + 2 }, (_, i) =>
      group(`sym${i}`, [caller(`c${i}`, `src/f${i}.ts`)]),
    );
    const bySymbols = buildBlastGraph(mapOf(manySymbols));
    expect(bySymbols.nodes.filter((n) => n.kind === "symbol")).toHaveLength(GRAPH_MAX_SYMBOLS);
    expect(bySymbols.hiddenCount).toBe(2);

    const manyCallers = Array.from({ length: GRAPH_MAX_CALLERS + 3 }, (_, i) => caller(`c${i}`, `src/f${i}.ts`));
    const byCallers = buildBlastGraph(mapOf([group("alpha", manyCallers)]));
    expect(byCallers.nodes.filter((n) => n.kind === "caller")).toHaveLength(GRAPH_MAX_CALLERS);
    expect(byCallers.hiddenCount).toBe(3);

    const endpoints = Array.from({ length: GRAPH_MAX_FACTS + 4 }, (_, i) => `GET /e${i}`);
    const byFacts = buildBlastGraph(
      mapOf([group("alpha", [caller("one", "src/f1.ts")])], [{ file: "src/f1.ts", endpoints, crons: ["* * * * *"] }]),
    );
    expect(byFacts.nodes.filter((n) => n.kind === "endpoint")).toHaveLength(GRAPH_MAX_FACTS);
    expect(byFacts.nodes.some((n) => n.kind === "cron")).toBe(false);
    expect(byFacts.hiddenCount).toBe(5);
  });

  it("ignores the facts of callers that were cut", () => {
    const manyCallers = Array.from({ length: GRAPH_MAX_CALLERS + 1 }, (_, i) => caller(`c${i}`, `src/f${i}.ts`));
    const cutFile = `src/f${GRAPH_MAX_CALLERS}.ts`;
    const graph = buildBlastGraph(
      mapOf([group("alpha", manyCallers)], [{ file: cutFile, endpoints: ["GET /hidden"], crons: [] }]),
    );

    expect(graph.nodes.some((n) => n.id === "e:GET /hidden")).toBe(false);
    expect(graph.hiddenCount).toBe(1);
  });

  it("returns no nodes for an empty map and a minimum height of one row", () => {
    const graph = buildBlastGraph(mapOf([]));

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.height).toBe(2 * GRAPH_PADDING + GRAPH_NODE_HEIGHT);
  });
});

describe("label helpers", () => {
  it("adds parentheses to functions and methods only", () => {
    expect(symbolLabel("rateLimit", "function")).toBe("rateLimit()");
    expect(symbolLabel("run", "method")).toBe("run()");
    expect(symbolLabel("Config", "class")).toBe("Config");
    expect(symbolLabel("Config", undefined)).toBe("Config");
  });

  it("keeps the first kind seen for a name", () => {
    const kinds = kindBySymbol([
      { name: "x", file: "a.ts", kind: "function" },
      { name: "x", file: "b.ts", kind: "class" },
    ]);
    expect(kinds.get("x")).toBe("function");
  });

  it("truncates only labels over the limit", () => {
    const atLimit = "b".repeat(GRAPH_LABEL_MAX_CHARS);
    expect(truncateLabel(atLimit)).toBe(atLimit);
    expect(truncateLabel(`${atLimit}c`)).toBe(`${"b".repeat(GRAPH_LABEL_MAX_CHARS - 1)}…`);
  });

  it("reads the calendar day off an ISO timestamp", () => {
    expect(isoDay("2026-03-18T10:00:00Z")).toBe("2026-03-18");
  });

  it("counts the changed symbols that have no downstream group", () => {
    const data = {
      ...mapOf([group("alpha", [caller("one", "src/f1.ts")])]),
      changed_symbols: [
        { name: "alpha", file: "a.ts", kind: "function" },
        { name: "beta", file: "a.ts", kind: "function" },
        { name: "gamma", file: "a.ts", kind: "class" },
      ],
    };
    expect(countSymbolsWithoutCallers(data)).toBe(2);
  });

  it("falls back to an unknown key when the index gave no reason", () => {
    expect(degradedReasonKey(null)).toBe("unknown");
    expect(degradedReasonKey("no_data")).toBe("no_data");
  });
});

describe("message catalog", () => {
  it("has a sentence for every degraded reason and for the unknown fallback", () => {
    const reasons = blast.degraded.reason as Record<string, string>;
    for (const key of [...DEGRADED_REASONS, "unknown"]) {
      expect(reasons[key], `blast.degraded.reason.${key}`).toBeTruthy();
    }
  });

  it("has a sentence for every reason prior PRs can be unavailable", () => {
    const reasons = blast.history.unavailable as Record<string, string>;
    for (const key of HISTORY_UNAVAILABLE_REASONS) {
      expect(reasons[key], `blast.history.unavailable.${key}`).toBeTruthy();
    }
  });
});
