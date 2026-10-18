import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { Sidebar } from "@devdigest/ui";
import shell from "../../../messages/en/shell.json";
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

describe("Multi-Agent Review navigation", () => {
  it("AC-49: shows Multi-Agent Review in the GLOBAL section, links to /repos/:repoId/multi-agent and marks it active on that path", () => {
    render(<Sidebar ctx={{ repoId: "r1" }} />);
    const link = screen.getByRole("link", { name: "Multi-Agent Review" });
    expect(link).toHaveAttribute("href", "/repos/r1/multi-agent");
    expect(within(link.parentElement as HTMLElement).getByText("GLOBAL")).toBeInTheDocument();
    cleanup();

    for (const path of ["/repos/r1/multi-agent", "/repos/r1/multi-agent/run1"]) {
      expect(activeKeyFor(path)).toBe("multi-agent");
    }
    render(<Sidebar ctx={{ repoId: "r1", activeKey: activeKeyFor("/repos/r1/multi-agent") }} />);
    const row = (name: string) => screen.getByRole("link", { name }).firstElementChild;
    expect(row("Multi-Agent Review")).toHaveStyle({ fontWeight: 600 });
    expect(row("Pull Requests")).toHaveStyle({ fontWeight: 500 });
  });
});

describe("Eval Dashboard navigation", () => {
  it("places the item in SKILLS LAB right after Conventions and links to /eval", () => {
    render(<Sidebar ctx={{ repoId: "r1" }} />);
    const names = screen.getAllByRole("link").map((l) => l.textContent);
    expect(names.indexOf("Eval Dashboard")).toBe(names.indexOf("Conventions") + 1);
    expect(screen.getByRole("link", { name: "Eval Dashboard" })).toHaveAttribute("href", "/eval");
  });

  it("labels the item with the shell message", () => {
    expect(shell.nav.eval).toBe("Eval Dashboard");
  });

  it("marks the item active on every path under /eval", () => {
    for (const path of ["/eval", "/eval/a1"]) expect(activeKeyFor(path)).toBe("eval");

    render(<Sidebar ctx={{ repoId: "r1", activeKey: activeKeyFor("/eval/a1") }} />);
    const row = (name: string) => screen.getByRole("link", { name }).firstElementChild;
    expect(row("Eval Dashboard")).toHaveStyle({ fontWeight: 600 });
    expect(row("Conventions")).toHaveStyle({ fontWeight: 500 });
  });
});
