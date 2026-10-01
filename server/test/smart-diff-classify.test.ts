import { describe, it, expect } from 'vitest';
import { SmartDiffRole } from '@devdigest/shared';
import { classifyFile } from '../src/modules/smart-diff/classify.js';
import { SMART_DIFF_ROLE_ORDER } from '../src/modules/smart-diff/constants.js';

const TABLE: [SmartDiffRole, string[]][] = [
  [
    'boilerplate',
    [
      'pnpm-lock.yaml',
      'client/pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock',
      'Cargo.lock',
      'dist/index.js',
      'client/dist/app.js',
      'src/api.generated.ts',
      'public/vendor.min.js',
      'src/__tests__/__snapshots__/x.snap',
    ],
  ],
  [
    'tests',
    [
      'server/test/smart-diff.it.test.ts',
      'client/src/x/DiffTab.test.tsx',
      'src/a.spec.ts',
      'src/__tests__/a.ts',
      'e2e/specs/05-pr-diff.flow.json',
      'e2e/README.md',
    ],
  ],
  [
    'wiring',
    [
      'server/src/modules/index.ts',
      'client/vitest.config.ts',
      'tsconfig.json',
      'server/tsconfig.build.json',
      '.eslintrc.json',
      '.env.example',
      'docker-compose.yml',
      '.github/workflows/server.yml',
      '.claude/skills/security/SKILL.md',
      'package.json',
      'server/package.json',
    ],
  ],
  [
    'docs',
    ['README.md', 'server/README.md', 'docs/agent-prompts/x.md', 'docs/diagram.png', 'CHANGELOG.md', 'LICENSE'],
  ],
  ['core', ['src/middleware/ratelimit.ts', 'src/config.ts', 'client/src/app/page.tsx']],
];

describe('classifyFile', () => {
  it.each(TABLE.flatMap(([role, paths]) => paths.map((p) => [p, role] as const)))(
    '%s -> %s',
    (path, role) => {
      expect(classifyFile(path)).toBe(role);
    },
  );

  it('lists every role of the contract, once, in SMART_DIFF_ROLE_ORDER', () => {
    expect([...SMART_DIFF_ROLE_ORDER].sort()).toEqual([...SmartDiffRole.options].sort());
  });
});
