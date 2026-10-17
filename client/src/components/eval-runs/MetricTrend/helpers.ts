export const TREND_AXIS_DEFAULT_MIN = 0.6;

export interface AxisBounds {
  min: number;
  max: number;
  ticks: number[];
}

/** Works in integer tenths so 0.3 and 0.7 do not drift. */
export function axisBounds(values: readonly number[]): AxisBounds {
  const defaultTenth = Math.round(TREND_AXIS_DEFAULT_MIN * 10);
  let tenth = defaultTenth;
  if (values.length > 0) {
    const lowest = Math.min(...values);
    const lowestTenth = Math.max(0, Math.floor(Math.round(lowest * 1000) / 100));
    tenth = Math.min(defaultTenth, lowestTenth);
  }
  const ticks: number[] = [];
  for (let t = tenth; t <= 10; t++) ticks.push(t / 10);
  return { min: tenth / 10, max: 1, ticks };
}

export function xFraction(index: number, count: number): number {
  return count <= 1 ? 0.5 : index / (count - 1);
}

/** 0 at the bottom of the axis, 1 at the top. */
export function yFraction(value: number, bounds: { min: number; max: number }): number {
  return (value - bounds.min) / (bounds.max - bounds.min);
}

/** Index lists of every stretch of two or more neighbouring non-null values. */
export function lineSegments(values: readonly (number | null)[]): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length >= 2) segments.push(current);
    current = [];
  };
  values.forEach((v, i) => {
    if (v === null) flush();
    else current.push(i);
  });
  flush();
  return segments;
}

export function stepActive(
  active: number | null,
  key: "ArrowLeft" | "ArrowRight",
  count: number,
): number | null {
  if (count === 0) return null;
  if (active === null) return key === "ArrowRight" ? 0 : count - 1;
  const next = active + (key === "ArrowRight" ? 1 : -1);
  return Math.min(count - 1, Math.max(0, next));
}
