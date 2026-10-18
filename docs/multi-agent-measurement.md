# Multi-agent measurement — 1 agent vs 3 agents

Same PR, same day, read from `agent_runs` on `devdigest_review` (AC-52). No scaling, no rounding to a ratio.

- PR: `vklyovsa/dev-digest#5` "feat(client): duration formatting helpers" (+54 / −0)
- Model: `deepseek/deepseek-v4-flash` via OpenRouter, every agent
- Date: 2026-10-18

## Runs

| Multi-agent run | Agent | tokens in | tokens out | cost, USD | duration, ms |
|---|---|---|---|---|---|
| `6185939e` (1 agent) | General Reviewer | 7 478 | 2 447 | 0.000175 | 25 774 |
| `524d5c96` (3 agents) | General Reviewer | 7 478 | 3 716 | 0.000164 | 37 874 |
| `524d5c96` (3 agents) | Security Reviewer | 6 870 | 1 278 | 0.000133 | 13 971 |
| `524d5c96` (3 agents) | Test Quality Reviewer | 7 390 | 2 871 | 0.000186 | 28 498 |

Wall-clock = max(child `ran_at` + `duration_ms`) − parent `ran_at`.

| | 1 agent | 3 agents | 3 / 1 |
|---|---|---|---|
| tokens in | 7 478 | 21 738 | 2.91 |
| tokens out | 2 447 | 7 865 | 3.21 |
| cost, USD | 0.000175 | 0.000483 | 2.76 |
| wall-clock, s | 25.8 | 37.9 | 1.47 |
| findings | 2 | 7 (3 groups, 3 conflicts) | — |

## Reading

- Cost grew 2.76×, not 3×: the agents' prompts differ in length and output length varies run to run.
- The same General Reviewer on the same PR wrote 2 447 tokens out once and 3 716 the next time, at a slightly lower cost — output length is noise of the same order as the difference being measured.
- Wall-clock grew 1.47×, not 3×: the children run concurrently and the total is the slowest child, here General Reviewer's longer second answer.
- The diff and intent are prepared once per multi-agent run; tokens in per agent stay ~7k, so nothing is shared at the prompt level.
