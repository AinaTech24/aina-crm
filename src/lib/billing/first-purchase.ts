/**
 * Is this firm's next purchase its FIRST? Decides whether the 6-month
 * commitment rule applies (lib/billing/aum-pricing.ts `cyclesOffered`).
 *
 * Read from the database every time — never from the browser — so a crafted
 * request cannot make a new firm look like an existing one. A firm that is
 * active (or in grace), or has any payment on record (an AUM tax invoice, or a
 * legacy Razorpay payment in `last_payment_at`), is an existing firm.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { isFirstPurchase } from "./aum-pricing";

export async function loadFirstPurchase(tx: Tx, tenantId: string): Promise<boolean> {
  const r = (await tx.execute(sql`
    SELECT s.status, s.last_payment_at,
           (SELECT count(*)::int FROM billing_invoices i WHERE i.tenant_id = ${tenantId}::uuid) AS paid_invoices
      FROM subscriptions s WHERE s.tenant_id = ${tenantId}::uuid LIMIT 1
  `)).rows[0] as { status: string; last_payment_at: string | null; paid_invoices: number } | undefined;
  if (!r) return true;
  return isFirstPurchase({ status: r.status, lastPaymentAt: r.last_payment_at, paidInvoices: Number(r.paid_invoices) });
}
