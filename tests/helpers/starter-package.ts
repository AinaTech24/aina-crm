/**
 * Firm creation (lib/onboarding/create-firm.ts) attaches the new firm to a
 * package — "starter", else the first active one — and refuses with
 * `no_package` when the catalog is empty. Seeded databases have packages; CI's
 * database is built from the migrations alone and has none. A billing DB test
 * calls this first so it does not depend on seed data. Idempotent.
 */
import type { SQL } from "drizzle-orm";

export async function ensureStarterPackage(
  exec: (q: SQL) => Promise<unknown>,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => SQL
): Promise<void> {
  await exec(sql`
    INSERT INTO packages (key, name)
    SELECT 'starter', 'Starter'
     WHERE NOT EXISTS (SELECT 1 FROM packages WHERE key = 'starter')
  `);
}
