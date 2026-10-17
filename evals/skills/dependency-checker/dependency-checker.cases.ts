import type { SkillCase } from "../../src/index.js";

// This skill's job is to analyze real files (package.json, tsconfig.json, node_modules sizes),
// but "quality" cases run with no tools (skillTask measures the SKILL.md content in isolation —
// see tasks.ts). So each prompt inlines a small synthetic dataset the skill can reason over
// directly, standing in for what the skill would normally gather itself with Read/Bash/Grep.

const REPO_DATA = `Here is the data you'd normally gather yourself — treat it as already collected, and produce the report directly from it (do not ask for tool access or more data).

server/package.json dependencies: fastify@5.1.0, drizzle-orm@0.36.0, zod@3.23.8, pg@8.13.0, moment@2.30.1
server/package.json devDependencies: vitest@2.1.4, typescript@5.6.3, tsx@4.19.0
client/package.json dependencies: next@15.0.3, react@19.0.0, react-dom@19.0.0, @tanstack/react-query@5.59.0, zod@3.22.4, date-fns@4.1.0
client/package.json devDependencies: vitest@2.1.4, typescript@5.6.3, tailwindcss@3.4.14
reviewer-core/package.json dependencies: zod@3.23.8
reviewer-core/package.json devDependencies: typescript@5.6.3
e2e/package.json dependencies: (none runtime)
e2e/package.json devDependencies: playwright@1.48.2, typescript@5.6.3

Installed sizes (du -sh):
server/node_modules/moment: 4.2M
server/node_modules/drizzle-orm: 8.1M
server/node_modules/fastify: 6.5M
server/node_modules/pg: 3.8M
server/node_modules/zod: 2.1M
client/node_modules/next: 132M
client/node_modules/react-dom: 6.9M
client/node_modules/date-fns: 22M
client/node_modules/zod: 1.9M
reviewer-core/node_modules/zod: 2.1M
e2e/node_modules/playwright: 210M

server/package.json also declares zod@3.23.8, client/package.json declares zod@3.22.4, reviewer-core/package.json declares zod@3.23.8 — two resolved zod versions across three packages.

grep for imports crossing package boundaries:
- server/src/routes/reviews.ts imports types from "@shared/review-types" (alias to server/src/vendor/shared)
- server/src/services/review-service.ts imports "reviewer-core/src/pipeline.js" directly by relative path (not via the package's public entry point)
- client/src/lib/api-types.ts imports "@shared/review-types" (same alias as server)
- grep found no import of "moment" anywhere under server/src — only present in package.json`;

// Every practice names something only the skill teaches (a heading, a tier, a table column) and
// that the judge can quote. A practice the raw model passes too cannot show a regression —
// `pnpm eval:benchmark skills/dependency-checker` flags it `non_discriminating`.
export const cases: SkillCase[] = [
  {
    name: "full report follows the required 5-section structure with a Mermaid graph",
    kind: "quality",
    prompt: `Run a dependency check on this repo. I want the full report: graph, sizes, prioritized findings, recommendations.\n\n${REPO_DATA}`,
    grounding: ["```mermaid", "flowchart"],
    practices: [
      "the report has a section named 'Scope' listing which packages (client, server, reviewer-core, e2e) were analyzed",
      "the report includes a Mermaid diagram (a fenced ```mermaid code block using flowchart) showing dependency relationships between packages",
      "the report has a section with a size breakdown table showing dependencies and their installed size, not just a vague size statement",
      "the report has a 'Findings & Priorities' section (or equivalently named) that groups findings under explicit severity tiers such as P0, P1, P2, or Info — not an unranked bullet list",
      "the report ends with a Summary section giving 3-5 concrete, actionable takeaways ordered by priority",
    ],
    threshold: 0.7,
    maxTurns: 10,
  },
  {
    name: "distinguishes internal (path-alias) dependencies from external npm dependencies",
    kind: "quality",
    prompt: `This repo isn't a monorepo — server, client, reviewer-core, and e2e share code via TypeScript path aliases, not workspace:* packages. Analyze our dependencies, including how these packages depend on each other internally.\n\n${REPO_DATA}`,
    practices: [
      "the findings table has a Kind column, and the finding about the relative import into reviewer-core/src/pipeline.js is marked `internal` there",
      "the relative import of reviewer-core/src/pipeline.js from server/src/services/review-service.ts is listed under the P0 tier as a boundary violation",
      "the report contains a Mermaid flowchart that draws the internal links (the @shared/review-types alias, the relative import into reviewer-core) apart from the external npm packages — as a separate diagram, a separate subgraph or a distinct arrow style",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "ranks version drift and an unused dependency in the P1 tier, each finding with an effort",
    kind: "quality",
    prompt: `We suspect some npm dependencies in server/ and client/ are unused or duplicated across packages with different versions. Check our dependencies and tell me what to prioritize fixing first.\n\n${REPO_DATA}`,
    practices: [
      "findings are explicitly labeled with one of the defined severity tiers (P0, P1, P2, or Info) rather than left unranked",
      "the zod version drift — 3.22.4 in client against 3.23.8 in server and reviewer-core — is listed under the P1 tier",
      "moment — declared in server/package.json, imported nowhere under server/src — is listed under the P1 tier as an unused runtime dependency",
      "the findings table has an Effort column with the values S, M or L",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
