/**
 * A well-formed uuid. Route params are user input: a hand-edited URL such as
 * /api/investors/abc must read as "not found", never reach Postgres as a
 * uuid cast and come back as a 500.
 *
 * Plain module, safe in the browser.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
