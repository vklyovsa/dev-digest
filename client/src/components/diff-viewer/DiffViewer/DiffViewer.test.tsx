import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import shell from "../../../../messages/en/shell.json";
import { DiffViewer } from "./DiffViewer";

afterEach(cleanup);

const PATCH = [
  "@@ -10,4 +10,5 @@",
  " const a = 1;",
  " const b = 2;",
  "+const c = 3;",
  "+const d = 4;",
  " const e = 5;",
].join("\n");

const FILES: PrFile[] = [
  { path: "src/a.ts", additions: 2, deletions: 0, patch: PATCH },
  { path: "src/b.ts", additions: 2, deletions: 0, patch: PATCH },
];

const RANGE = { path: "src/a.ts", startLine: 12, endLine: 13, label: "Expected lines" };

function renderViewer(props: Partial<React.ComponentProps<typeof DiffViewer>> = {}, files = FILES) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell }}>
      <DiffViewer files={files} {...props} />
    </NextIntlClientProvider>,
  );
}

const rowOf = (text: string) => screen.getAllByText(text)[0]!.closest("[data-in-range], div[style]")!;

describe("DiffViewer range marker", () => {
  it("marks the lines inside the range with a labelled glyph and no other line", () => {
    const { container } = renderViewer({ range: RANGE });

    const markers = screen.getAllByRole("img", { name: "Expected lines" });
    expect(markers).toHaveLength(2);
    const rows = container.querySelectorAll('[data-in-range="true"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("const c = 3;");
    expect(rows[1]!.textContent).toContain("const d = 4;");
    expect(rowOf("const b = 2;").getAttribute("data-in-range")).toBeNull();
  });

  it("marks nothing in a file other than the range's", () => {
    const { container } = renderViewer({ range: { ...RANGE, path: "src/b.ts" } });

    const marked = Array.from(container.querySelectorAll('[data-in-range="true"]'));
    expect(marked).toHaveLength(2);
    expect(container.querySelectorAll("[data-in-range]")).toHaveLength(2);
  });

  it("renders no marker without the prop", () => {
    const { container } = renderViewer();

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("[data-in-range]")).toBeNull();
  });

  it("does not mark a deleted line", () => {
    const patch = "@@ -1,2 +1,1 @@\n-gone\n kept";
    const { container } = renderViewer(
      { range: { path: "src/a.ts", startLine: 1, endLine: 1, label: "Expected lines" } },
      [{ path: "src/a.ts", additions: 0, deletions: 1, patch }],
    );

    const rows = container.querySelectorAll('[data-in-range="true"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("kept");
  });
});

describe("DiffViewer text safety and controls", () => {
  it("shows markup in a diff line as text and creates no element from it", () => {
    const patch = "@@ -1,1 +1,2 @@\n a\n+<img src=x onerror=alert(1)>";
    const { container } = renderViewer({}, [{ path: "src/a.ts", additions: 1, deletions: 0, patch }]);

    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("offers no comment control without commenting", () => {
    renderViewer({ range: RANGE });

    expect(screen.queryByRole("button", { name: "Add a comment on this line" })).not.toBeInTheDocument();
  });
});
