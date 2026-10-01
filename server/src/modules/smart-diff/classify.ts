import type { SmartDiffRole } from '@devdigest/shared';
import { CLASSIFICATION_RULES, DEFAULT_ROLE } from './constants.js';

export function classifyFile(path: string): SmartDiffRole {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.patterns.some((p) => p.test(path))) return rule.role;
  }
  return DEFAULT_ROLE;
}
