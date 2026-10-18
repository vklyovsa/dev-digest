export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

export function runButtonKey(count: number): "select" | "one" | "many" {
  return count === 0 ? "select" : count === 1 ? "one" : "many";
}
