/**
 * The AMFI reference tables are GLOBAL — `amfi_feed_imports`, `scheme_nav`,
 * `scheme_registrar_map`, `registrar_amc_identity` — and applying a feed or an
 * operator approval re-decides EVERY firm's registrar codes
 * (`redecideEverywhere`). Test files that write them therefore change each
 * other's fixtures when vitest runs them in parallel: the "latest feed" moves
 * under a running file, and a re-decision rewrites another file's
 * `scheme_rta_codes` rows mid-test (B-1 stabilisation, I-7).
 *
 * Every file that writes that state holds this lock for its whole run, on its
 * own connection, so those files run one after another while the rest of the
 * suite stays parallel. A session-level advisory lock is released when the
 * connection closes, so a crashed file can never wedge the others.
 */
import pg from "pg";

const KEY = "tests:global-amfi-reference";
/** Long enough for the other holders to finish; well under CI's job timeout. */
export const GLOBAL_AMFI_LOCK_TIMEOUT_MS = 600_000;

export async function lockGlobalAmfi(connectionString: string): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [KEY]);
  return async () => {
    try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [KEY]); } finally { await client.end(); }
  };
}
