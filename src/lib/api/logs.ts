/** Page sizes the logs page offers. The engine caps a search at 1000. */
export const LOG_PAGE_SIZES = [50, 100, 200, 500] as const;

export const LOG_DEFAULT_LIMIT = 100;

/**
 * Below the engine's ceiling. A thousand log lines in one table is a page
 * nobody reads, and the select on the page stops at the largest size here.
 */
export const LOG_MAX_LIMIT = 500;
