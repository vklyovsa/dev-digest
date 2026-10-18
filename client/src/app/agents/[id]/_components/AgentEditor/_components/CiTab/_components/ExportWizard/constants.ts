import type { CiExportInputBody } from "@devdigest/shared";

type Trigger = NonNullable<CiExportInputBody["triggers"]>[number];
type PostAs = NonNullable<CiExportInputBody["post_as"]>;

/** The contract's `repo` pattern, copied because the client imports only types from the shared package. */
export const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.\.?$)[A-Za-z0-9._-]+$/;

export const TRIGGERS = ["opened", "synchronize", "reopened"] as const satisfies readonly Trigger[];
export const DEFAULT_TRIGGERS: readonly Trigger[] = ["opened", "synchronize"];

export const POST_AS = [
  { value: "github_review", labelKey: "githubReview" },
  { value: "pr_comment", labelKey: "prComment" },
  { value: "none", labelKey: "none" },
] as const satisfies readonly { value: PostAs; labelKey: string }[];

export const SECRET_KEY = "OPENROUTER_API_KEY";
export const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";
export const RUNNER_PATH = ".devdigest/runner/index.js";

export const STEP_KEYS = ["target", "preview", "configure", "install"] as const;

/** Fails the type check when the contract gains a trigger or a post mode this file does not list. */
export type MissingTrigger = Exclude<Trigger, (typeof TRIGGERS)[number]>;
export type MissingPostAs = Exclude<PostAs, (typeof POST_AS)[number]["value"]>;
export const CONTRACT_IN_SYNC: [MissingTrigger, MissingPostAs] extends [never, never] ? true : never = true;
