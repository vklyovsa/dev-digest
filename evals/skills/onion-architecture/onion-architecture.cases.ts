import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const file = (path: string, fixture: string) => `File: ${path}\n\`\`\`ts\n${fx(fixture)}\n\`\`\``;

const NO_FILES =
  "The rules/*.md files, examples.md and the repository cannot be opened in this session. " +
  "Everything needed is in this message: answer now from what you already know, and do not ask for a file.";

export const cases: SkillCase[] = [
  // The gate holds only `Verdict` and the threshold is 1 on a single practice: with OA-10
  // gone from the skill the judge still runs, records the practice as failed, and the case is red.
  {
    name: "review cites OA-10 for a plain Error thrown by a use case",
    kind: "quality",
    prompt: `Review this new file for layering before it is merged.\n\n${file("server/src/modules/reminders/service.ts", "reminders-service.ts")}\n\n${NO_FILES}`,
    grounding: ["Verdict"],
    practices: ["a Must fix row cites `OA-10` for the `throw new Error` in server/src/modules/reminders/service.ts"],
    threshold: 1,
  },
  {
    name: "review cites OA-1 and OA-2 in a Must fix table and gives a BLOCK verdict",
    kind: "quality",
    prompt: `Review this change to the pulls routes for layering before it is merged.\n\n${file("server/src/modules/pulls/routes.ts", "pulls-routes.ts")}\n\n${NO_FILES}`,
    grounding: ["Must fix", "BLOCK"],
    practices: [
      "a Must fix row cites `OA-1` for the `drizzle-orm` import in server/src/modules/pulls/routes.ts",
      "a Must fix row cites `OA-2` for the `container.github()` call in the refresh route",
      "the verdict reads `BLOCK` followed by the number of must-fix items",
    ],
    threshold: 0.6,
  },
  {
    name: "new external capability is placed on the port, adapter, mock and container files",
    kind: "quality",
    prompt: `This use case must also post the published digest to a Slack channel. Slack is a new external capability for the backend. List every file you would create or change, in the order you would build them, with one line on what goes into each. Do not write the code.\n\n${file("server/src/modules/digests/service.ts", "digests-service.ts")}\n\n${NO_FILES}`,
    grounding: ["vendor/shared/adapters.ts", "src/adapters/mocks.ts"],
    practices: [
      "the port for Slack is declared in `vendor/shared/adapters.ts` at an earlier step than the adapter that implements it",
      "the adapter class for Slack is placed under `src/adapters/`",
      "the Slack adapter is constructed in `platform/container.ts`",
    ],
    threshold: 0.6,
  },
];
