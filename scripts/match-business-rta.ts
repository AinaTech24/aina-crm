/**
 * Check booked business against the RTA now, for one firm or every firm.
 *
 * The same pass that runs after each RTA import and every night
 * (lib/business/rta-match.ts) — for the first backfill after migration 0228,
 * or to see the result straight away. Safe to repeat: settled lines stay
 * settled, and a second run changes nothing.
 *
 * USAGE:
 *   tsx scripts/match-business-rta.ts --arn ARN-90577
 *   tsx scripts/match-business-rta.ts --tenant <uuid>
 *   tsx scripts/match-business-rta.ts --all
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "../src/db/client";
import { matchBookedBusiness } from "../src/lib/business/rta-match";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
};
const ARN = flag("--arn");
const TENANT = flag("--tenant");
const ALL = args.includes("--all");

async function main() {
  if (!ARN && !TENANT && !ALL) throw new Error("Pass --arn <ARN>, --tenant <uuid> or --all.");

  const firms = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, display_name FROM tenants
       WHERE deleted_at IS NULL
         ${ARN ? sql`AND upper(arn) = upper(${ARN})` : sql``}
         ${TENANT ? sql`AND id = ${TENANT}::uuid` : sql``}
       ORDER BY display_name
    `);
    return r.rows as Array<{ id: string; display_name: string }>;
  });
  if (!firms.length) throw new Error("No matching firm.");

  for (const f of firms) {
    const s = await withTenant(f.id, (tx) => matchBookedBusiness(tx, f.id));
    console.log(
      `${f.display_name}: ${s.checked} line(s) checked — ${s.confirmed} confirmed, ${s.mismatch} amount differs, `
      + `${s.rejected} rejected, ${s.not_found} not found, ${s.pending} awaiting RTA, ${s.not_applicable} not in RTA`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n${e?.message ?? e}\n`);
    process.exit(1);
  });
