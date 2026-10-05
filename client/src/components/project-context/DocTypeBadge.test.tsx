import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DocTypeBadge } from "./DocTypeBadge";
import { DOC_TYPE_COLORS } from "./constants";

afterEach(cleanup);

function badgeColors(type: string) {
  render(<DocTypeBadge type={type} />);
  const badge = screen.getByText(type);
  return { color: badge.style.color, background: badge.style.background };
}

describe("DocTypeBadge", () => {
  it.each(["specs", "docs", "insights"] as const)("renders %s with its own colours", (type) => {
    const { color, background } = badgeColors(type);
    expect(color).toBe(DOC_TYPE_COLORS[type].color);
    expect(background).toBe(DOC_TYPE_COLORS[type].bg);
  });

  it("gives the three known types three different colours", () => {
    const colors = (["specs", "docs", "insights"] as const).map((t) => DOC_TYPE_COLORS[t].color);
    expect(new Set(colors).size).toBe(3);
  });

  it("shows an unknown type's own text in none of the three type colours", () => {
    const { color, background } = badgeColors("adr");
    const typeColors = Object.values(DOC_TYPE_COLORS);
    expect(color).not.toBe("");
    expect(typeColors.map((c) => c.color)).not.toContain(color);
    expect(typeColors.map((c) => c.bg)).not.toContain(background);
  });
});
