import { describe, it, expect } from "vitest";
import type { SpecFile } from "@devdigest/shared";
import { selectedPath } from "./helpers";

const doc = (path: string): SpecFile => ({ path, type: "specs", tokens: 1, agent_count: 0 });
const DOCS = [doc("specs/a.md"), doc("docs/b.md")];

describe("selectedPath", () => {
  it("keeps a doc parameter that names a listed document", () => {
    expect(selectedPath(DOCS, "docs/b.md")).toBe("docs/b.md");
  });

  it("falls back to the first document when the parameter is absent or not listed", () => {
    expect(selectedPath(DOCS, null)).toBe("specs/a.md");
    expect(selectedPath(DOCS, "specs/gone.md")).toBe("specs/a.md");
  });

  it("is null for an empty list, whatever the parameter", () => {
    expect(selectedPath([], null)).toBeNull();
    expect(selectedPath([], "specs/a.md")).toBeNull();
  });
});
