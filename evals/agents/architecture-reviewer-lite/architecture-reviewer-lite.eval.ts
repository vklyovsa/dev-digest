import { describeAgent, runAgentCases } from "../../src/index.js";
// Deliberately the strict variant's cases: same prompts, fixtures, practices, thresholds and turn
// budget. Only the injected agent body differs, which is what makes the pair a controlled A/B.
import { cases } from "../architecture-reviewer/architecture-reviewer.cases.js";

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", cases));
