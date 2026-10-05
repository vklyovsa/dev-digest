import { describe, it, expect } from "vitest";
import { splitDocPath, matchesDocQuery, docTypeColors, formatRoots } from "./helpers";
import { DOC_TYPE_COLORS, NEUTRAL_DOC_TYPE_COLORS } from "./constants";

describe("splitDocPath", () => {
  it("splits the file name from the folder, keeping the trailing slash", () => {
    expect(splitDocPath("specs/a/b.md")).toEqual({ name: "b.md", folder: "specs/a/" });
  });

  it("returns an empty folder for a bare file name", () => {
    expect(splitDocPath("b.md")).toEqual({ name: "b.md", folder: "" });
  });
});

describe("matchesDocQuery", () => {
  it("matches a substring of the whole path, ignoring letter case", () => {
    expect(matchesDocQuery("specs/Public-API.md", "public-api")).toBe(true);
    expect(matchesDocQuery("specs/public-api.md", "SPECS/")).toBe(true);
  });

  it("rejects text the path does not contain, and matches everything for an empty query", () => {
    expect(matchesDocQuery("docs/a.md", "specs")).toBe(false);
    expect(matchesDocQuery("docs/a.md", "")).toBe(true);
  });
});

describe("formatRoots", () => {
  it("names each folder with a trailing slash, separated by a middle dot", () => {
    expect(formatRoots(["specs", "docs", "insights"])).toBe("specs/ · docs/ · insights/");
    expect(formatRoots([])).toBe("");
  });
});

describe("docTypeColors", () => {
  it("returns the neutral colours for an unlisted type", () => {
    expect(docTypeColors("adr")).toBe(NEUTRAL_DOC_TYPE_COLORS);
    expect(docTypeColors("__proto__")).toBe(NEUTRAL_DOC_TYPE_COLORS);
    expect(docTypeColors("specs")).toBe(DOC_TYPE_COLORS.specs);
  });
});
