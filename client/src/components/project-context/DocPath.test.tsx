import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DocPath } from "./DocPath";

afterEach(cleanup);

describe("DocPath", () => {
  it("gives the whole path as the title", () => {
    render(<DocPath path="specs/payments/refunds/long-spec-name.md" />);
    expect(screen.getByTitle("specs/payments/refunds/long-spec-name.md")).toBeInTheDocument();
  });

  it("cuts the folder with an ellipsis and never the file name", () => {
    render(<DocPath path="specs/payments/refunds/long-spec-name.md" />);
    const folder = screen.getByText("specs/payments/refunds/");
    const name = screen.getByText("long-spec-name.md");
    expect(folder).toHaveStyle({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    expect(name.style.textOverflow).toBe("");
    expect(name.style.overflow).toBe("");
    expect(name).toHaveStyle({ flexShrink: 0 });
  });

  it("renders a path with no folder as the file name alone", () => {
    render(<DocPath path="README.md" />);
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByTitle("README.md").children).toHaveLength(1);
  });
});
