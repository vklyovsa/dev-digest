import { describe, it, expect } from "vitest";
import { axisBounds, lineSegments, stepActive, xFraction, yFraction } from "./helpers";

describe("axisBounds", () => {
  it("scales from 0.6 to 1.0 with a tick at each tenth", () => {
    expect(axisBounds([0.7, 0.95, 1])).toEqual({ min: 0.6, max: 1, ticks: [0.6, 0.7, 0.8, 0.9, 1] });
  });

  it("keeps 0.6 when the lowest value is exactly 0.6", () => {
    expect(axisBounds([0.6, 0.8]).min).toBe(0.6);
  });

  it("lowers the bottom to the tenth at or below the lowest value", () => {
    const bounds = axisBounds([0.45, 0.9]);
    expect(bounds.min).toBe(0.4);
    expect(bounds.ticks).toEqual([0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  it("does not drift on exact tenths", () => {
    expect(axisBounds([0.3]).min).toBe(0.3);
    expect(axisBounds([0]).min).toBe(0);
  });

  it("gives the default bounds for no values", () => {
    expect(axisBounds([])).toEqual({ min: 0.6, max: 1, ticks: [0.6, 0.7, 0.8, 0.9, 1] });
  });
});

describe("xFraction", () => {
  it("centres a single run", () => {
    expect(xFraction(0, 1)).toBe(0.5);
  });

  it("spaces runs evenly from left to right", () => {
    expect([0, 1, 2].map((i) => xFraction(i, 3))).toEqual([0, 0.5, 1]);
  });
});

describe("yFraction", () => {
  it("is 0 at the bottom and 1 at the top", () => {
    const bounds = { min: 0.6, max: 1 };
    expect(yFraction(0.6, bounds)).toBe(0);
    expect(yFraction(1, bounds)).toBe(1);
    expect(yFraction(0.8, bounds)).toBeCloseTo(0.5, 10);
  });
});

describe("lineSegments", () => {
  it("joins neighbouring values into one segment", () => {
    expect(lineSegments([0.7, 0.8, 0.9])).toEqual([[0, 1, 2]]);
  });

  it("draws no line to or from a null", () => {
    expect(lineSegments([0.7, null, 0.9])).toEqual([]);
  });

  it("splits at a null", () => {
    expect(lineSegments([0.7, 0.8, null, 0.6, 0.9])).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  it("draws no line for a single value", () => {
    expect(lineSegments([0.7])).toEqual([]);
  });
});

describe("stepActive", () => {
  it("starts at the oldest on Right and the newest on Left", () => {
    expect(stepActive(null, "ArrowRight", 3)).toBe(0);
    expect(stepActive(null, "ArrowLeft", 3)).toBe(2);
  });

  it("moves by one and clamps at the ends", () => {
    expect(stepActive(0, "ArrowRight", 3)).toBe(1);
    expect(stepActive(2, "ArrowRight", 3)).toBe(2);
    expect(stepActive(1, "ArrowLeft", 3)).toBe(0);
    expect(stepActive(0, "ArrowLeft", 3)).toBe(0);
  });

  it("is null when nothing is plotted", () => {
    expect(stepActive(null, "ArrowRight", 0)).toBeNull();
    expect(stepActive(1, "ArrowLeft", 0)).toBeNull();
  });
});
