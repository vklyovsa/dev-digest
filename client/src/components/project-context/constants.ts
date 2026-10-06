/** Badge colours of the folder names the server searches by default; any other type is neutral. */
export const DOC_TYPE_COLORS = {
  specs: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  docs: { color: "var(--ok)", bg: "var(--ok-bg)" },
  insights: { color: "var(--warn)", bg: "var(--warn-bg)" },
} as const;

export const DEFAULT_DOC_TYPES: readonly string[] = Object.keys(DOC_TYPE_COLORS);

export const CONTEXT_TOKEN_BUDGET = 8000;

export const NEUTRAL_DOC_TYPE_COLORS = {
  color: "var(--text-secondary)",
  bg: "var(--bg-hover)",
} as const;
