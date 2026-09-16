# Specs — e2e

Two kinds of file live here, split by extension:

- **`NN-name.flow.json` — executable flows.** `run.ts` loads exactly `*.flow.json`,
  in lexical filename order, and runs every step through agent-browser.
- **`<slug>.spec.md` — written specs:** the intent behind a flow that does not exist
  yet, or the acceptance criteria an existing flow encodes.

Everything else in this folder — including this README — is inert to the runner.

## Writing a flow

- Steps are agent-browser commands passed verbatim; a non-zero exit fails the flow.
- `wait --text` / `wait --url` **are** the assertions. `"assert": { "stdoutIncludes" }`
  adds an optional substring check.
- Deterministic locators only (`--url`, `--text`, `find role|text|label`); never the
  AI `chat` command.
- `{BASE}` is substituted with `E2E_BASE_URL`.
- Stay on read-only seeded data so no flow triggers a model call.
- Give every step a `label` — it is what you read in the failure output.

See `../README.md` § "How a flow works" for the full step schema.

## Writing a spec

- Sections: **Journey · Preconditions (seeded state) · Steps · What proves it passed**.
- Delete the spec once the flow exists, or keep it only if it records a decision the
  JSON cannot express.
