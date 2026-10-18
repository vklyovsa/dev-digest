import { stringify } from 'yaml';
import { ValidationError } from '../../platform/errors.js';
import { ARTIFACT_NAME, PINNED_ACTIONS, POST_MODES, RESULT_FILE, RUNNER_PATH, TRIGGERS } from './constants.js';

export interface WorkflowOptions {
  triggers: readonly string[];
  postAs: string;
}

export function renderWorkflow({ triggers, postAs }: WorkflowOptions): string {
  const types = TRIGGERS.filter((t) => triggers.includes(t));
  if (types.length === 0) throw new ValidationError('Select at least one trigger');
  if (!(POST_MODES as readonly string[]).includes(postAs)) {
    throw new ValidationError(`Unknown post mode: ${postAs}`);
  }

  const workflow = {
    name: 'DevDigest Review',
    on: { pull_request: { types } },
    permissions: { contents: 'read', 'pull-requests': 'write' },
    jobs: {
      review: {
        'runs-on': 'ubuntu-latest',
        steps: [
          {
            uses: PINNED_ACTIONS.checkout,
            with: {
              ref: '${{ github.event.pull_request.base.sha }}',
              'persist-credentials': false,
            },
          },
          { uses: PINNED_ACTIONS.setupNode, with: { 'node-version': '22' } },
          {
            name: 'DevDigest review',
            run: `node ${RUNNER_PATH}`,
            env: {
              OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
              GITHUB_TOKEN: '${{ github.token }}',
              PR_NUMBER: '${{ github.event.pull_request.number }}',
              DEVDIGEST_POST_AS: postAs,
            },
          },
          {
            name: 'Upload result',
            if: 'always()',
            uses: PINNED_ACTIONS.uploadArtifact,
            with: { name: ARTIFACT_NAME, path: RESULT_FILE, 'if-no-files-found': 'ignore' },
          },
        ],
      },
    },
  };
  return stringify(workflow, { lineWidth: 0 });
}
