export interface DiffRange {
  path: string;
  /** New-side line numbers, inclusive. */
  startLine: number;
  endLine: number;
  /** Accessible name of the marker on each line inside the range. */
  label: string;
}

export interface DiffTarget {
  path: string;
  /** New-side line number. */
  line: string | null;
}
