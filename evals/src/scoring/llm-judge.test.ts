import { beforeEach, describe, expect, test, vi } from "vitest";
import { runContent } from "../runtime/dispatch.js";
import { llmJudge } from "./llm-judge.js";

vi.mock("../runtime/dispatch.js", () => ({ runContent: vi.fn() }));

const judge = vi.mocked(runContent);
const reply = (text: string) => ({ text }) as Awaited<ReturnType<typeof runContent>>;

const VERDICT =
  '{"results":[{"practice":"a","passed":true,"evidence":"quote"},{"practice":"b","passed":false,"evidence":""}]}';

describe("llmJudge", () => {
  beforeEach(() => judge.mockReset());

  test("scores a verdict wrapped in a markdown fence without asking again", async () => {
    judge.mockResolvedValueOnce(reply("```json\n" + VERDICT + "\n```"));

    const verdict = await llmJudge("output", ["a", "b"]);

    expect(verdict).toMatchObject({ passed: 1, total: 2, score: 0.5 });
    expect(judge).toHaveBeenCalledTimes(1);
  });

  test("asks once more when the first reply is not JSON", async () => {
    judge.mockResolvedValueOnce(reply("429 Rate limit exceeded")).mockResolvedValueOnce(reply(VERDICT));

    const verdict = await llmJudge("output", ["a", "b"]);

    expect(verdict.score).toBe(0.5);
    expect(judge).toHaveBeenCalledTimes(2);
    expect(judge.mock.calls[1][0]).toContain("not valid JSON");
  });

  test("asks once more when the JSON carries no results array", async () => {
    judge.mockResolvedValueOnce(reply('{"verdict":"pass"}')).mockResolvedValueOnce(reply(VERDICT));

    await expect(llmJudge("output", ["a", "b"])).resolves.toMatchObject({ passed: 1 });
  });

  test("throws when the retry is not JSON either", async () => {
    judge.mockResolvedValue(reply("I cannot judge this."));

    await expect(llmJudge("output", ["a"])).rejects.toThrow("after one retry");
    expect(judge).toHaveBeenCalledTimes(2);
  });
});
