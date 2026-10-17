export type ExpectationType = 'must_find' | 'must_not_flag';

export interface LineRange {
  file: string;
  startLine: number;
  endLine: number;
}

export function matchesExpectation(finding: LineRange, expectation: LineRange): boolean {
  if (finding.file !== expectation.file) return false;
  const findingLow = Math.min(finding.startLine, finding.endLine);
  const findingHigh = Math.max(finding.startLine, finding.endLine);
  const expectationLow = Math.min(expectation.startLine, expectation.endLine);
  const expectationHigh = Math.max(expectation.startLine, expectation.endLine);
  return findingLow <= expectationHigh && expectationLow <= findingHigh;
}

export interface CaseExecution {
  expectationType: ExpectationType;
  expectation: LineRange;
  kept: LineRange[];
  dropped: LineRange[];
}

export interface CaseTally {
  expectationType: ExpectationType;
  status: 'pass' | 'fail' | 'error';
  matched: number;
  grounded: number;
  produced: number;
}

export function scoreCase(execution: CaseExecution): CaseTally {
  const matched = execution.kept.filter((finding) =>
    matchesExpectation(finding, execution.expectation),
  ).length;
  const passed = execution.expectationType === 'must_find' ? matched >= 1 : matched === 0;
  return {
    expectationType: execution.expectationType,
    status: passed ? 'pass' : 'fail',
    matched,
    grounded: execution.kept.length,
    produced: execution.kept.length + execution.dropped.length,
  };
}

export function errorTally(expectationType: ExpectationType): CaseTally {
  return { expectationType, status: 'error', matched: 0, grounded: 0, produced: 0 };
}

export interface RunScore {
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  casesTotal: number;
  casesPassed: number;
  casesFailed: number;
  casesErrored: number;
  findingsTotal: number;
  findingsGrounded: number;
}

export function scoreRun(tallies: CaseTally[]): RunScore {
  const scored = tallies.filter((tally) => tally.status !== 'error');
  const mustFind = scored.filter((tally) => tally.expectationType === 'must_find');
  const mustNotFlag = scored.filter((tally) => tally.expectationType === 'must_not_flag');

  const mustFindPassed = mustFind.filter((tally) => tally.status === 'pass').length;
  const matchedOnMustNotFlag = mustNotFlag.reduce((sum, tally) => sum + tally.matched, 0);
  const findingsGrounded = scored.reduce((sum, tally) => sum + tally.grounded, 0);
  const findingsTotal = scored.reduce((sum, tally) => sum + tally.produced, 0);

  return {
    recall: mustFind.length === 0 ? null : mustFindPassed / mustFind.length,
    precision: findingsGrounded === 0 ? null : 1 - matchedOnMustNotFlag / findingsGrounded,
    citationAccuracy: findingsTotal === 0 ? null : findingsGrounded / findingsTotal,
    casesTotal: tallies.length,
    casesPassed: scored.filter((tally) => tally.status === 'pass').length,
    casesFailed: scored.filter((tally) => tally.status === 'fail').length,
    casesErrored: tallies.length - scored.length,
    findingsTotal,
    findingsGrounded,
  };
}
