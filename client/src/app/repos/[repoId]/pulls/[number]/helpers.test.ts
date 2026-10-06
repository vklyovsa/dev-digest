import { describe, it, expect } from "vitest";
import { diffTargetHref, readDiffTarget, tabQuery } from "./helpers";

const parse = (href: string) => new URL(href, "http://localhost");

describe("diffTargetHref", () => {
  it("keeps a path with a space and an ampersand intact when the href is parsed back", () => {
    const file = "src/my dir/a&b.ts";
    const href = diffTargetHref({ repoId: "r1", number: 7, file, line: 12 });

    expect(href).not.toContain(" ");
    expect(parse(href).searchParams.get("file")).toBe(file);
    expect(parse(href).searchParams.getAll("file")).toHaveLength(1);
  });

  it("holds tab=diff and the line, and no line when none is given", () => {
    const withLine = parse(diffTargetHref({ repoId: "r1", number: "7", file: "src/a.ts", line: 12 }));
    expect(withLine.pathname).toBe("/repos/r1/pulls/7");
    expect(withLine.searchParams.get("tab")).toBe("diff");
    expect(withLine.searchParams.get("line")).toBe("12");

    const withoutLine = parse(diffTargetHref({ repoId: "r1", number: 7, file: "src/a.ts" }));
    expect(withoutLine.searchParams.get("tab")).toBe("diff");
    expect(withoutLine.searchParams.get("file")).toBe("src/a.ts");
    expect(withoutLine.searchParams.has("line")).toBe(false);
  });
});

describe("tabQuery", () => {
  it("drops file and line, keeps trace, and sets the tab", () => {
    const search = new URLSearchParams("tab=diff&file=src%2Fa.ts&line=4&trace=run1");
    const params = new URLSearchParams(tabQuery(search, "overview"));

    expect(tabQuery(search, "overview").startsWith("?")).toBe(true);
    expect(params.get("tab")).toBe("overview");
    expect(params.get("trace")).toBe("run1");
    expect(params.has("file")).toBe(false);
    expect(params.has("line")).toBe(false);
  });
});

describe("readDiffTarget", () => {
  it("returns markup and a negative number as plain text", () => {
    const search = new URLSearchParams({ file: "<img src=x onerror=alert(1)>", line: "-3" });

    expect(readDiffTarget(search)).toEqual({ file: "<img src=x onerror=alert(1)>", line: "-3" });
  });

  it("returns null for a missing parameter", () => {
    expect(readDiffTarget(new URLSearchParams("tab=diff"))).toEqual({ file: null, line: null });
  });
});
