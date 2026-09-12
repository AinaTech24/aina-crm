/**
 * Client-import ceilings, shared by the parse route, the commit route and the
 * import UI so the number a user is told matches the number enforced.
 *
 * Lives in lib rather than in the route: a `route.ts` may export ONLY HTTP verbs
 * and route config — any other export fails `next build`, which local `tsc`
 * does not catch.
 */

/**
 * Rows accepted in one import. Raised from 5,000 so a firm can load its entire
 * book in a single file.
 *
 * The browser commits in CHUNKS of `IMPORT_COMMIT_CHUNK`, so raising this does
 * not grow any single request: 50,000 rows of JSON in one POST would be tens of
 * megabytes and would die at the proxy, and it would run as one very long
 * transaction on a burstable database.
 */
export const MAX_IMPORT_ROWS = 50_000;

/** A 50,000-row sheet does not fit in the old 10 MB ceiling. */
export const MAX_IMPORT_BYTES = 40 * 1024 * 1024;

/**
 * Rows per commit request. Small enough to stay well inside proxy body limits
 * and to keep each transaction short, large enough that 50,000 rows is 25
 * requests rather than thousands.
 */
export const IMPORT_COMMIT_CHUNK = 2_000;
