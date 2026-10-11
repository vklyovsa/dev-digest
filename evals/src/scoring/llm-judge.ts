/**
 * LLM Message Pattern judge, on the subscription. Binary PASS/FAIL per practice, PASS only with
 * a verbatim evidence quote. The judge defaults to a stronger family than the task to soften
 * single-model self-preference; the structural mitigations (blind + binary + verbatim) do the
 * rest, since on a shared subscription the families overlap.
 */

import { EVAL_JUDGE_MODEL } from "../config.js";
import { runContent } from "../runtime/dispatch.js";

const JUDGE_RUBRIC =
  "You are a strict, blind evaluator. Given an OUTPUT and a list of PRACTICES, judge each " +
  "practice independently.\n" +
  "Rules: (1) exactly PASS or FAIL per practice, no scales. (2) PASS only when a direct " +
  "verbatim quote from the OUTPUT is evidence the practice was met — a keyword is not " +
  "evidence. (3) Reply with ONLY minified JSON:\n" +
  '{"results":[{"practice":"<text>","passed":true,"evidence":"<verbatim quote>"}]}';

export interface Verdict {
  results: { practice: string; passed: boolean; evidence: string }[];
  passed: number;
  total: number;
  score: number;
}

const JSON_ONLY =
  "\n\nYour previous reply was not valid JSON. Reply with ONLY the minified JSON object — " +
  "no markdown fences, no text before or after it.";

function parseVerdict(text: string): Verdict["results"] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(obj.results) ? obj.results : null;
  } catch {
    return null;
  }
}

/** Judge an output against a list of practices. Model defaults to the stronger judge family. */
export async function llmJudge(output: string, practices: string[], model = EVAL_JUDGE_MODEL): Promise<Verdict> {
  const listed = practices.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const prompt = `${JUDGE_RUBRIC}\n\n## PRACTICES\n${listed}\n\n## OUTPUT\n${output}\n\nReturn the JSON now.`;
  const ask = (text: string) => runContent(text, { allowedTools: [], maxTurns: 1, model });

  // A cheap judge model sometimes breaks its own JSON, and an OpenRouter error comes back as the
  // reply text; one corrected retry keeps a single bad reply from failing the case under test.
  let res = await ask(prompt);
  let results = parseVerdict(res.text);
  if (!results) {
    res = await ask(prompt + JSON_ONLY);
    results = parseVerdict(res.text);
  }
  if (!results) throw new Error(`judge returned no verdict JSON after one retry: ${res.text.slice(0, 200)}`);

  const total = results.length || 1;
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, total, score: passed / total };
}
