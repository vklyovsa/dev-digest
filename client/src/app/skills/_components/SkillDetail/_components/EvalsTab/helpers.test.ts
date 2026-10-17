import { describe, it, expect } from "vitest";
import type { Agent, EvalRun } from "@devdigest/shared";
import { defaultHostId, orderHosts } from "./helpers";

const agent = (id: string) => ({ id, name: id }) as Agent;
const run = (agentId: string) => ({ agent_id: agentId }) as EvalRun;
const A = [agent("a1"), agent("a2"), agent("a3")];

describe("orderHosts", () => {
  it("puts the linked agents first, in link order, then the rest in list order", () => {
    expect(orderHosts(A, ["a3", "a2"]).map((a) => a.id)).toEqual(["a3", "a2", "a1"]);
  });

  it("keeps the list order when nothing is linked and ignores a link to an unknown agent", () => {
    expect(orderHosts(A, []).map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(orderHosts(A, ["gone"]).map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });
});

describe("defaultHostId", () => {
  it("is the host of the newest run when it is still an agent", () => {
    expect(defaultHostId([run("a3"), run("a1")], A, ["a2"])).toBe("a3");
  });

  it("falls back to the first linked agent, then the first agent, then null", () => {
    expect(defaultHostId([run("deleted")], A, ["a2"])).toBe("a2");
    expect(defaultHostId([], A, ["a2"])).toBe("a2");
    expect(defaultHostId(undefined, A, [])).toBe("a1");
    expect(defaultHostId([], [], [])).toBeNull();
  });
});
