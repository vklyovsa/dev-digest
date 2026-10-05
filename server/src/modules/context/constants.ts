export const MARKDOWN_EXTENSION = '.md';

/** How many document files one request or run start reads at the same time. */
export const READ_CONCURRENCY = 16;

export const SKIP_NOT_FOUND = 'not found in this repository';
export const SKIP_UNREADABLE = 'unreadable';
export const SKIP_EMPTY = 'empty';

export type SkipReason = typeof SKIP_NOT_FOUND | typeof SKIP_UNREADABLE | typeof SKIP_EMPTY;
