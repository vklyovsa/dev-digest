import { describe, expect, it } from 'vitest';
import {
  errorTally,
  matchesExpectation,
  scoreCase,
  scoreRun,
  type CaseExecution,
  type CaseTally,
  type ExpectationType,
  type LineRange,
} from './scoring.js';

const FILE = 'src/a.ts';

const range = (startLine: number, endLine: number, file = FILE): LineRange => ({
  file,
  startLine,
  endLine,
});

const execution = (
  expectationType: ExpectationType,
  kept: LineRange[],
  dropped: LineRange[] = [],
  expectation: LineRange = range(10, 20),
): CaseExecution => ({ expectationType, expectation, kept, dropped });

const tally = (overrides: Partial<CaseTally> = {}): CaseTally => ({
  expectationType: 'must_find',
  status: 'pass',
  matched: 0,
  grounded: 0,
  produced: 0,
  ...overrides,
});

describe('matchesExpectation (AC-50)', () => {
  it('matches when the ranges share only the last line of the finding', () => {
    expect(matchesExpectation(range(10, 12), range(12, 20))).toBe(true);
  });

  it('matches when the ranges share only the first line of the finding', () => {
    expect(matchesExpectation(range(12, 20), range(10, 12))).toBe(true);
  });

  it('does not match adjacent ranges that share no line, finding first', () => {
    expect(matchesExpectation(range(10, 11), range(12, 20))).toBe(false);
  });

  it('does not match adjacent ranges that share no line, finding second', () => {
    expect(matchesExpectation(range(12, 20), range(10, 11))).toBe(false);
  });

  it('does not match a finding that starts one line after the expectation ends', () => {
    expect(matchesExpectation(range(13, 14), range(10, 12))).toBe(false);
  });

  it('does not match when the file differs and the ranges are identical', () => {
    expect(matchesExpectation(range(10, 20, 'src/b.ts'), range(10, 20))).toBe(false);
  });

  it('does not match when the finding path only extends the expectation path', () => {
    expect(matchesExpectation(range(10, 20, 'src/a.tsx'), range(10, 20))).toBe(false);
  });

  it('matches two single-line ranges on the same line', () => {
    expect(matchesExpectation(range(5, 5), range(5, 5))).toBe(true);
  });

  it('does not match two single-line ranges on neighbouring lines', () => {
    expect(matchesExpectation(range(5, 5), range(6, 6))).toBe(false);
  });

  it('matches when the finding contains the expectation', () => {
    expect(matchesExpectation(range(1, 100), range(50, 51))).toBe(true);
  });

  it('matches when the expectation contains the finding', () => {
    expect(matchesExpectation(range(50, 51), range(1, 100))).toBe(true);
  });

  it('matches a reversed finding range through its lower bound', () => {
    expect(matchesExpectation(range(20, 12), range(10, 12))).toBe(true);
  });

  it('matches a reversed finding range through its upper bound', () => {
    expect(matchesExpectation(range(12, 5), range(10, 11))).toBe(true);
  });

  it('does not match a reversed finding range that stays after the expectation', () => {
    expect(matchesExpectation(range(20, 13), range(10, 12))).toBe(false);
  });

  it('does not match a reversed finding range that stays before the expectation', () => {
    expect(matchesExpectation(range(11, 5), range(12, 20))).toBe(false);
  });

  it('matches a reversed expectation range through its lower bound', () => {
    expect(matchesExpectation(range(12, 20), range(12, 10))).toBe(true);
  });

  it('matches a reversed expectation range through its upper bound', () => {
    expect(matchesExpectation(range(10, 11), range(12, 5))).toBe(true);
  });

  it('does not match a reversed expectation range that stays before the finding', () => {
    expect(matchesExpectation(range(12, 20), range(11, 10))).toBe(false);
  });

  it('does not match a reversed expectation range that stays after the finding', () => {
    expect(matchesExpectation(range(10, 12), range(20, 13))).toBe(false);
  });
});

describe('scoreCase', () => {
  describe('grounding gate (AC-51)', () => {
    it('gives no match for an overlapping finding that the gate dropped', () => {
      const result = scoreCase(execution('must_find', [], [range(12, 14)]));
      expect(result.matched).toBe(0);
    });

    it('fails a must_find case whose only overlapping finding was dropped', () => {
      const result = scoreCase(execution('must_find', [], [range(12, 14)]));
      expect(result.status).toBe('fail');
    });

    it('passes a must_not_flag case whose only overlapping finding was dropped', () => {
      const result = scoreCase(execution('must_not_flag', [], [range(12, 14)]));
      expect(result.status).toBe('pass');
    });

    it('counts a kept overlapping finding although a dropped one overlaps too', () => {
      const result = scoreCase(execution('must_find', [range(12, 14)], [range(15, 16)]));
      expect(result.matched).toBe(1);
    });
  });

  describe('must_find (AC-52)', () => {
    it('passes on exactly one match', () => {
      const result = scoreCase(execution('must_find', [range(15, 16)]));
      expect(result.status).toBe('pass');
    });

    it('passes on two matches', () => {
      const result = scoreCase(execution('must_find', [range(15, 16), range(18, 25)]));
      expect(result.status).toBe('pass');
    });

    it('fails when a kept finding sits in another file', () => {
      const result = scoreCase(execution('must_find', [range(15, 16, 'src/b.ts')]));
      expect(result.status).toBe('fail');
    });

    it('fails when a kept finding ends one line before the expectation', () => {
      const result = scoreCase(execution('must_find', [range(1, 9)]));
      expect(result.status).toBe('fail');
    });

    it('fails when the execution kept no finding', () => {
      const result = scoreCase(execution('must_find', []));
      expect(result.status).toBe('fail');
    });

    it('passes when a kept finding shares only the first line of the expectation', () => {
      const result = scoreCase(execution('must_find', [range(1, 10)]));
      expect(result.status).toBe('pass');
    });
  });

  describe('must_not_flag (AC-53)', () => {
    it('passes when the execution kept no finding', () => {
      const result = scoreCase(execution('must_not_flag', []));
      expect(result.status).toBe('pass');
    });

    it('passes when the kept findings are in another file', () => {
      const result = scoreCase(execution('must_not_flag', [range(15, 16, 'src/b.ts')]));
      expect(result.status).toBe('pass');
    });

    it('passes when a kept finding ends one line before the expectation', () => {
      const result = scoreCase(execution('must_not_flag', [range(1, 9)]));
      expect(result.status).toBe('pass');
    });

    it('fails on exactly one match', () => {
      const result = scoreCase(execution('must_not_flag', [range(15, 16)]));
      expect(result.status).toBe('fail');
    });

    it('fails on two matches', () => {
      const result = scoreCase(execution('must_not_flag', [range(15, 16), range(20, 30)]));
      expect(result.status).toBe('fail');
    });
  });

  describe('matched (AC-54)', () => {
    it('is 2 for two overlapping kept findings', () => {
      const result = scoreCase(execution('must_find', [range(15, 16), range(20, 30)]));
      expect(result.matched).toBe(2);
    });

    it('is 1 for one overlapping and one non-overlapping kept finding', () => {
      const result = scoreCase(execution('must_find', [range(15, 16), range(21, 30)]));
      expect(result.matched).toBe(1);
    });

    it('is 0 when no kept finding overlaps', () => {
      const result = scoreCase(execution('must_not_flag', [range(1, 9), range(21, 30)]));
      expect(result.matched).toBe(0);
    });

    it('is recorded for a must_not_flag case that failed', () => {
      const result = scoreCase(execution('must_not_flag', [range(15, 16), range(20, 30)]));
      expect(result.matched).toBe(2);
    });

    it('is taken against the case expectation, not a fixed range', () => {
      const result = scoreCase(
        execution('must_find', [range(1, 3)], [], range(3, 4)),
      );
      expect(result.matched).toBe(1);
    });
  });

  describe('grounded and produced (AC-57)', () => {
    it('grounded counts the kept findings', () => {
      const result = scoreCase(execution('must_find', [range(1, 2), range(3, 4)], [range(5, 6)]));
      expect(result.grounded).toBe(2);
    });

    it('produced adds the dropped findings to the kept ones', () => {
      const result = scoreCase(
        execution('must_find', [range(1, 2), range(3, 4)], [range(5, 6), range(7, 8), range(9, 9)]),
      );
      expect(result.produced).toBe(5);
    });

    it('are both 0 for an execution without findings', () => {
      const result = scoreCase(execution('must_not_flag', []));
      expect({ grounded: result.grounded, produced: result.produced }).toEqual({
        grounded: 0,
        produced: 0,
      });
    });

    it('counts non-matching kept findings as grounded', () => {
      const result = scoreCase(execution('must_not_flag', [range(1, 2), range(3, 4), range(40, 41)]));
      expect(result.grounded).toBe(3);
    });
  });

  it('carries the expectation type of a must_find execution', () => {
    expect(scoreCase(execution('must_find', [])).expectationType).toBe('must_find');
  });

  it('carries the expectation type of a must_not_flag execution', () => {
    expect(scoreCase(execution('must_not_flag', [])).expectationType).toBe('must_not_flag');
  });

  it('returns the full tally for a passing must_find execution', () => {
    expect(scoreCase(execution('must_find', [range(12, 14), range(1, 2)], [range(30, 31)]))).toEqual({
      expectationType: 'must_find',
      status: 'pass',
      matched: 1,
      grounded: 2,
      produced: 3,
    });
  });

  it('never returns the status error', () => {
    const statuses = [
      scoreCase(execution('must_find', [])).status,
      scoreCase(execution('must_find', [range(12, 14)])).status,
      scoreCase(execution('must_not_flag', [])).status,
      scoreCase(execution('must_not_flag', [range(12, 14)])).status,
    ];
    expect(statuses).toEqual(['fail', 'pass', 'pass', 'fail']);
  });
});

describe('errorTally', () => {
  it('records a must_find error with zero counts', () => {
    expect(errorTally('must_find')).toEqual({
      expectationType: 'must_find',
      status: 'error',
      matched: 0,
      grounded: 0,
      produced: 0,
    });
  });

  it('records a must_not_flag error with zero counts', () => {
    expect(errorTally('must_not_flag')).toEqual({
      expectationType: 'must_not_flag',
      status: 'error',
      matched: 0,
      grounded: 0,
      produced: 0,
    });
  });
});

describe('scoreRun', () => {
  describe('recall (AC-55)', () => {
    const mustFind = (status: 'pass' | 'fail') => tally({ expectationType: 'must_find', status });

    it('is 0.75 for 3 passed of 4 must_find cases', () => {
      const score = scoreRun([
        mustFind('pass'),
        mustFind('pass'),
        mustFind('pass'),
        mustFind('fail'),
      ]);
      expect(score.recall).toBe(0.75);
    });

    it('is 1 when every must_find case passed', () => {
      expect(scoreRun([mustFind('pass'), mustFind('pass')]).recall).toBe(1);
    });

    it('is 0, not null, when no must_find case passed', () => {
      expect(scoreRun([mustFind('fail'), mustFind('fail')]).recall).toBe(0);
    });

    it('is 0.5 for 1 passed of 2 whatever the must_not_flag cases did', () => {
      const score = scoreRun([
        mustFind('pass'),
        mustFind('fail'),
        tally({ expectationType: 'must_not_flag', status: 'pass' }),
        tally({ expectationType: 'must_not_flag', status: 'fail' }),
        tally({ expectationType: 'must_not_flag', status: 'pass' }),
      ]);
      expect(score.recall).toBe(0.5);
    });

    it('is 1 for one passed must_find case beside a failed must_not_flag case', () => {
      const score = scoreRun([
        mustFind('pass'),
        tally({ expectationType: 'must_not_flag', status: 'fail' }),
      ]);
      expect(score.recall).toBe(1);
    });
  });

  describe('precision (AC-56)', () => {
    const mustNotFlag = (matched: number, grounded: number) =>
      tally({
        expectationType: 'must_not_flag',
        status: matched === 0 ? 'pass' : 'fail',
        matched,
        grounded,
        produced: grounded,
      });

    it('is 0.75 for one must_not_flag case with four grounded findings, one matching', () => {
      expect(scoreRun([mustNotFlag(1, 4)]).precision).toBe(0.75);
    });

    it('is 1, not null, when grounded findings exist and none matches', () => {
      expect(scoreRun([mustNotFlag(0, 4)]).precision).toBe(1);
    });

    it('is 0 when every grounded finding matches its must_not_flag expectation', () => {
      expect(scoreRun([mustNotFlag(2, 2)]).precision).toBe(0);
    });

    it('sums matches and grounded findings over several must_not_flag cases', () => {
      expect(scoreRun([mustNotFlag(1, 2), mustNotFlag(2, 6)]).precision).toBe(0.625);
    });

    it('adds the grounded findings of must_find cases to the divisor only', () => {
      const score = scoreRun([
        tally({
          expectationType: 'must_find',
          status: 'pass',
          matched: 3,
          grounded: 4,
          produced: 4,
        }),
        mustNotFlag(1, 4),
      ]);
      expect(score.precision).toBe(0.875);
    });

    it('is 1 when only must_find cases kept findings', () => {
      const score = scoreRun([
        tally({ expectationType: 'must_find', status: 'pass', matched: 2, grounded: 2, produced: 2 }),
      ]);
      expect(score.precision).toBe(1);
    });

    it('is null for a run without grounded findings (AC-58)', () => {
      const score = scoreRun([
        tally({ expectationType: 'must_find', status: 'fail' }),
        tally({ expectationType: 'must_not_flag', status: 'pass' }),
      ]);
      expect(score.precision).toBeNull();
    });

    it('is null when every produced finding was dropped (AC-58)', () => {
      const score = scoreRun([
        tally({ expectationType: 'must_find', status: 'fail', grounded: 0, produced: 3 }),
      ]);
      expect(score.precision).toBeNull();
    });
  });

  describe('citation accuracy (AC-57)', () => {
    it('is 0.75 for 3 kept and 1 dropped', () => {
      const score = scoreRun([tally({ grounded: 3, produced: 4 })]);
      expect(score.citationAccuracy).toBe(0.75);
    });

    it('sums grounded and produced over several cases', () => {
      const score = scoreRun([
        tally({ grounded: 1, produced: 2 }),
        tally({ expectationType: 'must_not_flag', status: 'pass', grounded: 2, produced: 6 }),
      ]);
      expect(score.citationAccuracy).toBe(0.375);
    });

    it('is 1 when nothing was dropped', () => {
      expect(scoreRun([tally({ grounded: 2, produced: 2 })]).citationAccuracy).toBe(1);
    });

    it('is 0, not null, when every produced finding was dropped', () => {
      expect(scoreRun([tally({ grounded: 0, produced: 2 })]).citationAccuracy).toBe(0);
    });

    it('is null when the executions produced no finding (AC-58)', () => {
      expect(scoreRun([tally(), tally({ expectationType: 'must_not_flag' })]).citationAccuracy)
        .toBeNull();
    });
  });

  describe('zero divisors (AC-58)', () => {
    it('gives recall null for a run of must_not_flag cases only', () => {
      const score = scoreRun([
        tally({ expectationType: 'must_not_flag', status: 'pass', grounded: 2, produced: 2 }),
        tally({ expectationType: 'must_not_flag', status: 'pass' }),
      ]);
      expect(score.recall).toBeNull();
    });

    it('keeps precision a number for a run of must_not_flag cases that kept findings', () => {
      const score = scoreRun([
        tally({ expectationType: 'must_not_flag', status: 'pass', grounded: 2, produced: 2 }),
      ]);
      expect(score.precision).toBe(1);
    });

    it('gives precision null for a run without findings', () => {
      expect(scoreRun([tally({ status: 'fail' })]).precision).toBeNull();
    });

    it('gives citation accuracy null for a run without findings', () => {
      expect(scoreRun([tally({ status: 'fail' })]).citationAccuracy).toBeNull();
    });

    it('gives recall null, and the other metrics null, for a run with no case', () => {
      const score = scoreRun([]);
      expect([score.recall, score.precision, score.citationAccuracy]).toEqual([null, null, null]);
    });

    it('gives zero counts for a run with no case', () => {
      expect(scoreRun([])).toMatchObject({
        casesTotal: 0,
        casesPassed: 0,
        casesFailed: 0,
        casesErrored: 0,
        findingsTotal: 0,
        findingsGrounded: 0,
      });
    });
  });

  describe('counts', () => {
    it('counts passed, failed and errored cases apart', () => {
      const score = scoreRun([
        tally({ status: 'pass' }),
        tally({ status: 'pass' }),
        tally({ status: 'pass' }),
        tally({ status: 'fail' }),
        tally({ status: 'fail' }),
        errorTally('must_find'),
      ]);
      expect([score.casesPassed, score.casesFailed, score.casesErrored]).toEqual([3, 2, 1]);
    });

    it('counts every case, errored ones included, in casesTotal', () => {
      const score = scoreRun([
        tally({ status: 'pass' }),
        tally({ status: 'fail' }),
        errorTally('must_find'),
        errorTally('must_not_flag'),
      ]);
      expect(score.casesTotal).toBe(4);
    });

    it('sums the produced findings into findingsTotal', () => {
      const score = scoreRun([
        tally({ grounded: 1, produced: 3 }),
        tally({ expectationType: 'must_not_flag', status: 'pass', grounded: 2, produced: 2 }),
      ]);
      expect(score.findingsTotal).toBe(5);
    });

    it('sums the kept findings into findingsGrounded', () => {
      const score = scoreRun([
        tally({ grounded: 1, produced: 3 }),
        tally({ expectationType: 'must_not_flag', status: 'pass', grounded: 2, produced: 2 }),
      ]);
      expect(score.findingsGrounded).toBe(3);
    });
  });

  describe('error cases (AC-59)', () => {
    const passingFind = tally({
      expectationType: 'must_find',
      status: 'pass',
      matched: 1,
      grounded: 2,
      produced: 3,
    });
    const failingNotFlag = tally({
      expectationType: 'must_not_flag',
      status: 'fail',
      matched: 1,
      grounded: 2,
      produced: 2,
    });
    const noisyError = (expectationType: ExpectationType) =>
      tally({ expectationType, status: 'error', matched: 5, grounded: 7, produced: 11 });

    it('scores three cases with one error as the other two alone', () => {
      const withError = scoreRun([passingFind, errorTally('must_find'), failingNotFlag]);
      const without = scoreRun([passingFind, failingNotFlag]);
      expect({ ...withError, casesTotal: 0, casesErrored: 0 }).toEqual({
        ...without,
        casesTotal: 0,
        casesErrored: 0,
      });
    });

    it('keeps a must_find error out of recall', () => {
      expect(scoreRun([passingFind, noisyError('must_find')]).recall).toBe(1);
    });

    it('keeps a must_not_flag error out of the precision numerator', () => {
      expect(scoreRun([failingNotFlag, noisyError('must_not_flag')]).precision).toBe(0.5);
    });

    it('keeps an error out of the precision divisor', () => {
      expect(scoreRun([failingNotFlag, noisyError('must_find')]).precision).toBe(0.5);
    });

    it('keeps an error out of citation accuracy', () => {
      expect(scoreRun([passingFind, noisyError('must_find')]).citationAccuracy).toBe(2 / 3);
    });

    it('keeps an error out of findingsTotal', () => {
      expect(scoreRun([passingFind, noisyError('must_not_flag')]).findingsTotal).toBe(3);
    });

    it('keeps an error out of findingsGrounded', () => {
      expect(scoreRun([passingFind, noisyError('must_not_flag')]).findingsGrounded).toBe(2);
    });

    it('keeps an error out of casesPassed and casesFailed', () => {
      const score = scoreRun([passingFind, failingNotFlag, noisyError('must_find')]);
      expect([score.casesPassed, score.casesFailed]).toEqual([1, 1]);
    });

    it('counts the error in casesErrored only', () => {
      const score = scoreRun([passingFind, noisyError('must_find')]);
      expect([score.casesTotal, score.casesErrored]).toEqual([2, 1]);
    });

    it('gives null metrics and only the error counts for a run of errors alone', () => {
      expect(scoreRun([errorTally('must_find'), errorTally('must_not_flag')])).toEqual({
        recall: null,
        precision: null,
        citationAccuracy: null,
        casesTotal: 2,
        casesPassed: 0,
        casesFailed: 0,
        casesErrored: 2,
        findingsTotal: 0,
        findingsGrounded: 0,
      });
    });
  });

  it('returns every field of a mixed run', () => {
    const score = scoreRun([
      scoreCase(execution('must_find', [range(12, 14)], [range(40, 41)])),
      scoreCase(execution('must_find', [range(1, 2)])),
      scoreCase(execution('must_not_flag', [range(15, 16), range(50, 51)])),
      errorTally('must_find'),
    ]);
    expect(score).toEqual({
      recall: 0.5,
      precision: 0.75,
      citationAccuracy: 0.8,
      casesTotal: 4,
      casesPassed: 1,
      casesFailed: 2,
      casesErrored: 1,
      findingsTotal: 5,
      findingsGrounded: 4,
    });
  });
});
