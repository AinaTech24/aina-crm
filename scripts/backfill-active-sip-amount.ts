/**
 * Backfill investors.active_sip_amount from the live SIP book.
 *
 * The cache is the monthly-equivalent sum of a client's active SIPs, written
 * only by refreshActiveSipAmount (lib/metrics/sip.ts). Every SIP write and the
 * nightly scanner keep it fresh; this pass corrects every firm at once.
 * Idempotent. Safe in prod.
 *
 *   npx tsx scripts/backfill-active-sip-amount.ts
 */

import "dotenv/config";

process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";

import { withSystem } from "../src/db/client";
import { refreshActiveSipAmount } from "../src/lib/metrics/sip";

async function main() {
  const updated = await withSystem((tx) => refreshActiveSipAmount(tx));
  console.log(`[backfill] active_sip_amount corrected on ${updated} investor(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill] failed:", e?.message ?? e);
  process.exit(1);
});
