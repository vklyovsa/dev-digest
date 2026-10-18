import { fileURLToPath } from 'node:url';

export const CI_BRANCH = 'devdigest/ci';
export const WORKFLOW_FILE = 'devdigest-review.yml';
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';
export const RUNNER_PATH = '.devdigest/runner/index.js';
export const MEMORY_PATH = '.devdigest/memory.jsonl';
export const AGENTS_DIR = '.devdigest/agents/';
export const SKILLS_DIR = '.devdigest/skills/';

export const ARTIFACT_NAME = 'devdigest-result';
export const RESULT_FILE = 'devdigest-result.json';

export const PR_TITLE = 'Add DevDigest CI review';
export const COMMIT_MESSAGE = 'Add DevDigest CI review';
export const PR_BODY = [
  'Adds a DevDigest review agent to this repository.',
  '',
  '- `.devdigest/` holds the agent manifest, its skills, its memory and the bundled runner.',
  `- \`${WORKFLOW_PATH}\` runs the agent on every pull request event.`,
  '',
  'Add the `OPENROUTER_API_KEY` secret under Settings → Secrets and variables → Actions before merging.',
].join('\n');

export const PINNED_ACTIONS = {
  checkout: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262', // v4
  setupNode: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', // v4
  uploadArtifact: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02', // v4
} as const;

export const DEFAULT_RUNNER_BUNDLE = fileURLToPath(
  new URL('../../../../agent-runner/dist/index.js', import.meta.url),
);

export const SCANNED_SECRET_KEYS = [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GITHUB_TOKEN',
] as const;

export const MIN_SECRET_LENGTH = 8;

export const TRIGGERS = ['opened', 'synchronize', 'reopened'] as const;
export const POST_MODES = ['github_review', 'pr_comment', 'none'] as const;

export const SYNC_RUN_LIMIT = 20;
export const ARTIFACT_MAX_BYTES = 1_048_576;
export const RUN_LIST_LIMIT = 100;
export const INSTALLATION_RUN_WINDOW = 200;
