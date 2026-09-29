import prettyMilliseconds from "pretty-ms";

export function formatDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor(durationMs / 1000);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function formatDurationVerbose(durationMs: number): string {
  return prettyMilliseconds(durationMs, { verbose: true });
}

export function averageDuration(durations: number[]): number {
  const total = durations.reduce((sum, d) => sum + d, 0);
  return total / durations.length;
}
