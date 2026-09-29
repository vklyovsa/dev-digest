import type { SmartDiffRole } from '@devdigest/shared';

export const SMART_DIFF_ROLE_ORDER: readonly SmartDiffRole[] = [
  'core',
  'tests',
  'wiring',
  'docs',
  'boilerplate',
];

export const DEFAULT_ROLE: SmartDiffRole = 'core';

export interface ClassificationRule {
  role: Exclude<SmartDiffRole, 'core'>;
  patterns: readonly RegExp[];
}

/** First match wins; directory patterns match at any depth (multi-package repos). */
export const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    role: 'boilerplate',
    patterns: [
      /\.lock$/,
      /(^|\/)pnpm-lock\.yaml$/,
      /(^|\/)package-lock\.json$/,
      /(^|\/)yarn\.lock$/,
      /(^|\/)dist\//,
      /(^|\/)build\//,
      /(^|\/)__snapshots__\//,
      /\.snap$/,
      /\.generated\./,
      /\.min\.js$/,
    ],
  },
  {
    role: 'tests',
    patterns: [
      /\.test\.tsx?$/,
      /\.it\.test\.ts$/,
      /\.spec\.ts$/,
      /(^|\/)tests?\//,
      /(^|\/)__tests__\//,
      /(^|\/)e2e\//,
    ],
  },
  {
    role: 'wiring',
    patterns: [
      /(^|\/)index\.(ts|js)$/,
      /(^|\/)[^/]+\.config\.[^/]+$/,
      /(^|\/)tsconfig[^/]*\.json$/,
      /(^|\/)package\.json$/,
      /(^|\/)\.eslintrc[^/]*$/,
      /(^|\/)\.env[^/]*$/,
      /(^|\/)docker-compose[^/]*\.yml$/,
      /(^|\/)\.github\//,
      /(^|\/)\.claude\//,
    ],
  },
  {
    role: 'docs',
    patterns: [/\.md$/, /(^|\/)docs\//, /(^|\/)README[^/]*$/, /(^|\/)CHANGELOG[^/]*$/, /(^|\/)LICENSE$/],
  },
];
