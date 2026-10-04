export const HISTORY_SCAN_LIMIT = 50;
export const HISTORY_MAX_ITEMS = 10;

/**
 * A test file calls an endpoint (`app.inject`), it does not serve one, so its
 * facts are not attributed to the symbol it exercises. Declared here rather than
 * imported from `smart-diff`, whose classification serves another purpose.
 */
export const TEST_PATH_PATTERNS: readonly RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)(tests?|__tests__|__mocks__|__fixtures__|e2e)\//,
];
