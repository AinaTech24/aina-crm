/**
 * Test cleanup for the PLATFORM registrar mappings (scheme_registrar_map is not
 * per firm, so a test's verified mappings outlive its firm unless removed).
 * Its event table is append-only and only the table owner may lift the
 * trigger, so this needs ADMIN_DATABASE_URL; without it the rows stay (they
 * map the test's own registrar codes to the test's own AMFI codes, so a re-run
 * reaches the same decision).
 */
import pg from "pg";

export async function cleanupSchemeMap(_withSystem: unknown, _sql: unknown, amfiCodes: string[]) {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!amfiCodes.length || !url) return;
  const c = new pg.Client({ connectionString: url });
  try {
    await c.connect();
    await c.query("BEGIN");
    await c.query("ALTER TABLE scheme_registrar_map_events DISABLE TRIGGER scheme_registrar_map_events_immutable");
    await c.query("DELETE FROM scheme_registrar_map_events WHERE map_id IN (SELECT id FROM scheme_registrar_map WHERE amfi_scheme_code = ANY($1))", [amfiCodes]);
    await c.query("DELETE FROM scheme_registrar_map WHERE amfi_scheme_code = ANY($1)", [amfiCodes]);
    await c.query("ALTER TABLE scheme_registrar_map_events ENABLE TRIGGER scheme_registrar_map_events_immutable");
    await c.query("COMMIT");
  } catch {
    await c.query("ROLLBACK").catch(() => {});
  } finally {
    await c.end().catch(() => {});
  }
}
