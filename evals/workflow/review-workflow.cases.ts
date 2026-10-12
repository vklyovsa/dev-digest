import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md -> AGENTS.md, package
 * AGENTS.md files, skills, subagents; loaded via settingSources:["project"]) behaves as documented.
 *
 * Budget: 8 Claude sessions total.
 *   - 4 × trace     → 1 session each                                 = 4
 *   - 2 × activation pair (positive + near-miss negative)            = 4
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

  // --- trace (1 session each): one root "Read when" row per case --------------------------------
  // Two unrelated routes in one prompt do not hold on a cheap model: gemini-2.5-flash followed one
  // and guessed the other, a different one on each attempt.
  {
    kind: "trace",
    name: "root AGENTS.md routes an MCP tool-description change to mcp/AGENTS.md",
    prompt:
      "Хочу змінити опис одного з тулів MCP-сервера. Коду не чіпай. Знайди за настановами цього " +
      "репо, який документ треба прочитати перед такою зміною, і прочитай саме його.",
    expectFilesRead: ["mcp/AGENTS.md"],
    maxTurns: 6,
  },
  {
    kind: "trace",
    name: "root AGENTS.md routes a CI-lane question to TESTING.md",
    prompt:
      "Хочу зрозуміти, у яку CI-лінію потрапить новий тест сервера, що ходить у базу. Коду не " +
      "чіпай. Знайди за настановами цього репо, який документ про це треба прочитати, і прочитай " +
      "саме його.",
    expectFilesRead: ["TESTING.md"],
    maxTurns: 6,
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

  // --- activation pair (2 sessions): dependency-checker, positive + near-miss negative ----------
  {
    kind: "activation",
    name: "dependency-checker activates on a dependency audit request",
    prompt:
      "Перевір залежності цього репозиторію: що важке, що не використовується і де версії " +
      "розходяться між пакетами.",
    skill: "dependency-checker",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — a question about one dependency must NOT start a dependency audit",
    prompt:
      "Поясни, чим `dependencies` відрізняються від `devDependencies` у package.json і в яку з " +
      "секцій класти `vitest`.",
    skill: "dependency-checker",
    shouldActivate: false,
    maxTurns: 4,
  },
];
