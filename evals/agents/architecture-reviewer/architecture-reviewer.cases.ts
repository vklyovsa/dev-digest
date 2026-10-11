import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// agentTask strips Bash and the fixture files are not in the working tree. The prompt does not
// say so: handling an inline diff with fewer tools is the agent's own job (its Step 0).
const reviewPrompt = (fixture: string) => `Review this diff against DevDigest's documented architecture rules.

${fx(fixture)}`;

const CHECKOUT_PROMPT = reviewPrompt("checkout-service.diff");
const BENIGN_PROMPT = reviewPrompt("benign-refactor.diff");
const ALLOWED_IMPORT_PROMPT = reviewPrompt("cross-module-service.diff");

const FASTIFY_FINDING = "the `fastify` import (`FastifyReply`) in server/src/domain/checkout/pricing.ts";
const NEW_REPO_FINDING = "the `new PgCheckoutRepository()` call in server/src/modules/checkout/service.ts";

// Shared by the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite) variants:
// same prompts, fixtures, practices, thresholds and turn budget. Detection and severity are the
// controls; the rule-citation case is the one the relaxation is expected to move, and the benign
// case shows what the relaxation costs.
//
// The judge passes a practice only on a verbatim quote, so every practice names something
// quotable in the final report (a `### F<n>` heading, a `Rule:` line) — never an absence.
export const cases: AgentCase[] = [
  {
    name: "detects both seeded violations in the checkout diff",
    kind: "quality",
    prompt: CHECKOUT_PROMPT,
    grounding: ["# Architecture review", "## Findings (JSON)"],
    practices: [
      "the reply opens with the `# Architecture review` heading — no analysis or draft list of violations comes before it",
      `reports ${FASTIFY_FINDING} as a finding: the domain layer depends on the HTTP transport framework`,
      `reports ${NEW_REPO_FINDING} as a finding: a service constructs a concrete repository itself instead of receiving it from the composition root (platform/container.ts)`,
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "assigns a severity on the project scale to each checkout violation",
    kind: "quality",
    prompt: CHECKOUT_PROMPT,
    practices: [
      `the \`### F<n>\` heading of the finding about ${FASTIFY_FINDING} reads CRITICAL or WARNING`,
      `the \`### F<n>\` heading of the finding about ${NEW_REPO_FINDING} reads WARNING — depcruise does not catch it, so it is not CRITICAL`,
      "each `### F<n>` heading in the report carries one of CRITICAL, WARNING or SUGGESTION",
      "the `FastifyReply` import, the `reply` parameter typed with it and the `reply?.header(...)` call are reported under one `### F<n>` finding, with the parameter and the call quoted as its evidence",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites a specific documented rule for each checkout finding",
    kind: "quality",
    prompt: CHECKOUT_PROMPT,
    practices: [
      `names a specific documented rule for the finding about ${FASTIFY_FINDING} — the depcruise rule \`no-domain-to-infra\`, onion-architecture \`rules/domain-purity.md\` or \`rules/layers.md\`, or checklist item OA-7 — rather than describing the problem only in prose`,
      `names a specific documented rule for the finding about ${NEW_REPO_FINDING} — onion-architecture \`rules/ports-and-di.md\` (the composition root is the only place with \`new\`) or checklist item OA-13 — rather than describing the problem only in prose`,
      "each `### F<n>` block in the report has a `Rule` line that names a rule file, a depcruise rule or a checklist item",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "reports no finding for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "the `## Findings` section says `No findings.` for the rename of local variables in server/src/modules/blast/score.ts",
      "the closing `## Findings (JSON)` block is an empty array `[]`",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    // layers.md § Cross-module rules allows importing another module's service, so no documented
    // rule is broken here: the case where dropping "only a named rule is a finding" can show.
    name: "reports no finding for an allowed cross-module service import",
    kind: "quality",
    prompt: ALLOWED_IMPORT_PROMPT,
    practices: [
      "the `## Findings` section says `No findings.` for the `BillingService` constructor dependency added to server/src/modules/checkout/service.ts",
      "the closing `## Findings (JSON)` block is an empty array `[]`",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
