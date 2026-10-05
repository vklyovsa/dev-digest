import { describe, expect, it } from 'vitest';
import type { BlastRadius, PrBriefAnswer, ReviewFocusItem, Risk } from '@devdigest/shared';
import {
  allowedFiles,
  changedLineRanges,
  validateAnswer,
} from '../src/modules/brief/helpers.js';
import type { AnswerCheck, LineRange } from '../src/modules/brief/types.js';

const TWO_HUNKS = [
  '@@ -10,3 +10,4 @@ export function limit() {',
  '   port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  '   redisUrl: x,',
  '@@ -40,2 +41,5 @@',
  ' a',
  '+b',
  '+c',
  '+d',
  ' e',
].join('\n');

describe('changedLineRanges', () => {
  it('gives one range per hunk, from the new-side start and length', () => {
    expect(changedLineRanges(TWO_HUNKS)).toEqual([
      { start: 10, end: 13 },
      { start: 41, end: 45 },
    ]);
  });

  it('reads a header without a length as a single line', () => {
    expect(changedLineRanges('@@ -7 +9 @@\n-old\n+new')).toEqual([{ start: 9, end: 9 }]);
  });

  it('gives no range for a hunk whose new side has length 0', () => {
    expect(changedLineRanges('@@ -5,2 +4,0 @@\n-gone\n-gone too')).toEqual([]);
    expect(changedLineRanges('@@ -1,2 +0,0 @@\n-a\n-b\n@@ -9,1 +8,2 @@\n x\n+y')).toEqual([
      { start: 8, end: 9 },
    ]);
  });

  it.each([null, ''])('gives no range for the patch %j', (patch) => {
    expect(changedLineRanges(patch)).toEqual([]);
  });

  it('reads nothing after the second @@ of a header', () => {
    const patch = '@@ -1,2 +3,4 @@ const re = "@@ -9,9 +90,9 @@";\n+x';
    expect(changedLineRanges(patch)).toEqual([{ start: 3, end: 6 }]);
  });

  it('looks only at lines that start with @@, never at a changed line that quotes a header', () => {
    const patch = '@@ -1,1 +1,2 @@\n x\n+@@ -50,3 +60,3 @@\n- @@ -70,3 +80,3 @@';
    expect(changedLineRanges(patch)).toEqual([{ start: 1, end: 2 }]);
  });

  it('skips a line that starts with @@ but is not a hunk header', () => {
    expect(changedLineRanges('@@@ -1,2 -1,2 +1,3 @@@\n@@ nonsense @@\n+x')).toEqual([]);
  });
});

const blast: BlastRadius = {
  changed_symbols: [{ name: 'limit', file: 'src/limiter.ts', kind: 'function' }],
  downstream: [
    {
      symbol: 'limit',
      callers: [
        { name: 'handle', file: 'src/routes/pay.ts', line: 12 },
        { name: 'other', file: 'src/routes/refund.ts', line: 30 },
      ],
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary: 'one symbol, two callers',
};

describe('allowedFiles', () => {
  it('holds the PR files and, with a map, its changed-symbol and caller files', () => {
    expect(allowedFiles(['src/a.ts', 'src/b.ts'], blast)).toEqual(
      new Set([
        'src/a.ts',
        'src/b.ts',
        'src/limiter.ts',
        'src/routes/pay.ts',
        'src/routes/refund.ts',
      ]),
    );
  });

  it('holds the PR files alone when the brief has no map', () => {
    expect(allowedFiles(['src/a.ts'], null)).toEqual(new Set(['src/a.ts']));
  });
});

const risk = (over: Partial<Risk> = {}): Risk => ({
  kind: 'security',
  title: 'Key in source',
  explanation: 'A live key is committed.',
  severity: 'high',
  file_refs: ['src/a.ts'],
  ...over,
});

const focus = (over: Partial<ReviewFocusItem> = {}): ReviewFocusItem => ({
  file: 'src/a.ts',
  line: 11,
  reason: 'The key is added here.',
  ...over,
});

const answer = (risks: Risk[], review_focus: ReviewFocusItem[]): PrBriefAnswer => ({
  summary: 'Adds a limiter.',
  risks,
  review_focus,
});

const check: AnswerCheck = {
  allowed: allowedFiles(['src/a.ts', 'src/b.ts', 'src/nopatch.ts'], blast),
  ranges: new Map([
    ['src/a.ts', changedLineRanges(TWO_HUNKS)],
    ['src/b.ts', changedLineRanges('@@ -1 +1 @@\n-x\n+y')],
    ['src/nopatch.ts', changedLineRanges(null)],
  ]),
};

describe('validateAnswer — risks', () => {
  it('drops a risk whose title is empty or only whitespace', () => {
    const out = validateAnswer(
      answer([risk({ title: '' }), risk({ title: '  \n ' }), risk({ title: 'Kept' })], []),
      check,
    );

    expect(out.risks.map((r) => r.title)).toEqual(['Kept']);
    expect(out.discarded).toEqual({ risks: 2, reviewFocus: 0 });
  });

  it('removes each file_refs entry that is no allowed file and keeps PR and caller files', () => {
    const out = validateAnswer(
      answer(
        [risk({ file_refs: ['src/a.ts', 'src/invented.ts', 'src/routes/pay.ts'] })],
        [],
      ),
      check,
    );

    expect(out.risks).toHaveLength(1);
    expect(out.risks[0]!.file_refs).toEqual(['src/a.ts', 'src/routes/pay.ts']);
    expect(out.discarded.risks).toBe(0);
  });

  it('compares paths exactly: a case change, a ./ prefix and a :line suffix are not allowed files', () => {
    const out = validateAnswer(
      answer([risk({ file_refs: ['SRC/a.ts', './src/a.ts', 'src/a.ts:11', 'src/a.ts'] })], []),
      check,
    );

    expect(out.risks[0]!.file_refs).toEqual(['src/a.ts']);
  });

  it('drops a risk whose every entry is invented, and one with no entries', () => {
    const out = validateAnswer(
      answer(
        [
          risk({ file_refs: ['nope.ts', 'also/nope.ts'] }),
          risk({ file_refs: [] }),
          risk({ title: 'Kept', file_refs: ['src/b.ts'] }),
        ],
        [],
      ),
      check,
    );

    expect(out.risks.map((r) => r.title)).toEqual(['Kept']);
    expect(out.discarded.risks).toBe(2);
  });

  it('keeps every other field of a kept risk and the order of the list', () => {
    const first = risk({ title: 'First', severity: 'low', kind: 'perf', explanation: 'slow' });
    const second = risk({ title: 'Second', file_refs: ['src/b.ts', 'gone.ts'] });

    const out = validateAnswer(answer([first, second], []), check);

    expect(out.risks).toEqual([first, { ...second, file_refs: ['src/b.ts'] }]);
  });
});

describe('validateAnswer — review focus', () => {
  it('drops an item whose reason is empty or only whitespace', () => {
    const out = validateAnswer(
      answer([], [focus({ reason: '' }), focus({ reason: ' \t ' }), focus({ reason: 'Kept' })]),
      check,
    );

    expect(out.reviewFocus.map((i) => i.reason)).toEqual(['Kept']);
    expect(out.discarded).toEqual({ risks: 0, reviewFocus: 2 });
  });

  it('passes the file rule for a PR file and for a caller file', () => {
    const withCallerRange: AnswerCheck = {
      allowed: check.allowed,
      ranges: new Map<string, LineRange[]>([
        ...check.ranges,
        ['src/routes/pay.ts', [{ start: 10, end: 20 }]],
      ]),
    };
    const items = [
      focus({ file: 'src/b.ts', line: 1 }),
      focus({ file: 'src/routes/pay.ts', line: 12 }),
    ];

    const out = validateAnswer(answer([], items), withCallerRange);

    expect(out.reviewFocus).toEqual(items);
    expect(out.discarded.reviewFocus).toBe(0);
  });

  it('drops an invented path and a path that differs only in letter case', () => {
    const out = validateAnswer(
      answer([], [focus({ file: 'src/invented.ts' }), focus({ file: 'SRC/A.ts' })]),
      check,
    );

    expect(out.reviewFocus).toEqual([]);
    expect(out.discarded.reviewFocus).toBe(2);
  });

  it('keeps the first and the last line of a range and drops the lines just outside it', () => {
    const lines = [9, 10, 13, 14, 40, 41, 45, 46];

    const out = validateAnswer(answer([], lines.map((line) => focus({ line }))), check);

    expect(out.reviewFocus.map((i) => i.line)).toEqual([10, 13, 41, 45]);
    expect(out.discarded.reviewFocus).toBe(4);
  });

  it('drops an item of a PR file without a patch and of a file only the map names', () => {
    const out = validateAnswer(
      answer(
        [],
        [
          focus({ file: 'src/nopatch.ts', line: 1 }),
          focus({ file: 'src/limiter.ts', line: 1 }),
          focus({ file: 'src/b.ts', line: 1 }),
        ],
      ),
      check,
    );

    expect(out.reviewFocus.map((i) => i.file)).toEqual(['src/b.ts']);
    expect(out.discarded.reviewFocus).toBe(2);
  });

  it('keeps a repeated item twice, in the order the model gave', () => {
    const repeated = focus({ line: 12, reason: 'Same reason.' });
    const other = focus({ file: 'src/b.ts', line: 1, reason: 'Other.' });

    const out = validateAnswer(answer([], [repeated, other, repeated]), check);

    expect(out.reviewFocus).toEqual([repeated, other, repeated]);
    expect(out.discarded.reviewFocus).toBe(0);
  });

  it('counts nothing as discarded when every item and risk passes', () => {
    const out = validateAnswer(answer([risk()], [focus()]), check);

    expect(out.risks).toHaveLength(1);
    expect(out.reviewFocus).toHaveLength(1);
    expect(out.discarded).toEqual({ risks: 0, reviewFocus: 0 });
  });
});
