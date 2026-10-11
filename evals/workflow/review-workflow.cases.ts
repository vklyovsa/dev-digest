import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md -> AGENTS.md, package
 * AGENTS.md files, skills, subagents; loaded via settingSources:["project"]) behaves as documented.
 *
 * Budget: 5 Claude sessions total.
 *   - 3 × trace     → 1 session each, several assertions per session = 3
 *   - 1 × activation pair (positive + near-miss negative)            = 2
 *
 * Each trace is ONE chain of work, not a list of unrelated questions: package AGENTS.md -> the doc
 * only that file routes to -> (optionally) a subagent. A later link proves the earlier one worked,
 * so merging them costs no attribution. The activation pair cannot be merged: one session either
 * engaged the skill or it did not.
 *
 * The trace sees `Read` tool calls only. Root AGENTS.md is auto-loaded and never appears in it;
 * a package AGENTS.md appears because root AGENTS.md tells the agent to open it explicitly.
 * Paths match by substring — keep the package prefix (`client/AGENTS.md`, never `AGENTS.md`).
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): client/ — package AGENTS.md, then the doc only it routes to -----------
  {
    kind: "trace",
    name: "client findings task opens client/AGENTS.md and follows it to findings-surfaces.md",
    prompt:
      "Я збираюся змінити в client/ екран, який показує findings ревʼю. Коду поки не чіпай. " +
      "Спершу відкрий настанови пакета client і прочитай ту документацію, яку вони вимагають " +
      "прочитати перед такою зміною.",
    expectFilesRead: ["client/AGENTS.md", "client/docs/findings-surfaces.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): server/ — package AGENTS.md, its routed doc, then subagent dispatch ---
  {
    kind: "trace",
    // The column must NOT already exist, or the model reviews existing code inline instead of
    // planning-then-dispatching.
    name: "server PR-list task opens server/AGENTS.md, reads pr-list-read-model.md AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати до списку pull requests у server/ НОВУ, ще не реалізовану похідну колонку — " +
      "кількість відхилених findings. Коду не пиши. Спершу відкрий настанови пакета server і прочитай " +
      "документ, який вони вимагають для такої зміни. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/AGENTS.md", "server/docs/pr-list-read-model.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 10,
  },

  // --- trace (1 session): two root "Read when" rows at once -------------------------------------
  {
    kind: "trace",
    // The only trace that merges two UNRELATED routes, so it is the first suspect when the suite
    // goes flaky: split it into two cases before rewording the prompt.
    name: "root AGENTS.md routes an MCP question to mcp/AGENTS.md and a CI-lane question to TESTING.md",
    prompt:
      "Маю два окремі питання, коду не чіпай. (1) Хочу змінити опис одного з тулів MCP-сервера. " +
      "(2) Хочу зрозуміти, у яку CI-лінію потрапить новий тест сервера, що ходить у базу. " +
      "Для кожного питання знайди за настановами цього репо, який документ треба прочитати, " +
      "і прочитай саме ці документи.",
    expectFilesRead: ["mcp/AGENTS.md", "TESTING.md"],
    maxTurns: 8,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
