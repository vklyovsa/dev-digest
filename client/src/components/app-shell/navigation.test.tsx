import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Sidebar } from "@devdigest/ui";
import { activeKeyFor } from "./helpers";

afterEach(cleanup);

describe("Project Context navigation", () => {
  it("shows a Project Context link to the active repository's context page", () => {
    render(<Sidebar ctx={{ repoId: "r1" }} />);
    expect(screen.getByRole("link", { name: "Project Context" })).toHaveAttribute(
      "href",
      "/repos/r1/context",
    );
  });

  it("places the item in the WORKSPACE group right after Pull Requests", () => {
    render(<Sidebar ctx={{ repoId: "r1" }} />);
    const names = screen.getAllByRole("link").map((l) => l.textContent);
    expect(names.indexOf("Project Context")).toBe(names.indexOf("Pull Requests") + 1);
  });

  it("maps the context path to the context key and marks that item active", () => {
    const activeKey = activeKeyFor("/repos/r1/context");
    expect(activeKey).toBe("context");

    render(<Sidebar ctx={{ repoId: "r1", activeKey }} />);
    const row = (name: string) => screen.getByRole("link", { name }).firstElementChild;
    expect(row("Project Context")).toHaveStyle({ fontWeight: 600 });
    expect(row("Pull Requests")).toHaveStyle({ fontWeight: 500 });
  });
});
