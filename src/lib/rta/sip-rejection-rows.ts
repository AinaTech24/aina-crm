/**
 * SIP Rejections page rows from the registrar's transaction feed.
 *
 * A SIP instalment the registrar reports as rejected / failed is stored as a
 * transaction (type sip, status rejected / failed). The SIP Rejections page
 * reads `sip_rejections`, so each such transaction needs a tracker row there
 * (RM owner, 2-day follow-up, reason category). The dedicated rejection-report
 * file writes its own rows; this covers every firm that only gets the
 * transaction feed, which is most of them.
 *
 * It used to run once a day at 07:30 and look back only two days by import
 * time, so a bounce imported before the first scan of a new firm, or on a day
 * the worker was down, never got a row and the page stayed empty for good.
 * It now also runs right after every RTA import and looks back 90 days. It is
 * idempotent: a transaction (or the same client / date / amount that arrived
 * through the rejection report) is never given a second row.
 *
 * A row older than three days is stamped escalated, so catching up on history
 * does not send the owners an "overdue" alert for every old bounce.
 */

import { sql, type SQL } from "drizzle-orm";
import { withTenant } from "@/db/client";

type Executor = { execute: (q: SQL) => Promise<{ rows: unknown[] }> };

/** How far back (by the day the transaction was imported) a bounce is picked up. */
export const SIP_REJECTION_LOOKBACK_DAYS = 90;

export async function materialiseSipRejectionRows(
  tx: Executor,
  days: number = SIP_REJECTION_LOOKBACK_DAYS,
): Promise<number> {
  const n = Math.max(1, Math.min(3650, Math.floor(days)));
  const since = sql.raw(`${n} days`);
  const res = await tx.execute(sql`
    INSERT INTO sip_rejections (
      tenant_id, investor_id, transaction_id, rejection_date, rejection_amount,
      rejection_reason, scheme_name, folio_number, amc_name, assigned_rm_id,
      follow_up_date, recovery_status, reason_category, dedup_key, escalated_at
    )
    SELECT t.tenant_id, t.investor_id, t.id, t.order_date::date, t.amount,
      t.reason_description, t.scheme_name, t.folio_number, t.amc_name, i.rm_id,
      (t.order_date::date + 2), 'pending',
      CASE
        WHEN lower(coalesce(t.reason_description, '') || ' ' || coalesce(t.reason_code, ''))
             ~ 'insufficient|balance|funds|nsf|inqufd' THEN 'insufficient_balance'
        WHEN lower(coalesce(t.reason_description, '') || ' ' || coalesce(t.reason_code, ''))
             ~ 'mandate|expired|umrn|nach|debit not|not registered' THEN 'mandate_expired'
        ELSE 'technical'
      END,
      'tx:' || t.id::text,
      CASE WHEN t.order_date::date < current_date - 3 THEN now() ELSE NULL END
    FROM transactions t
    JOIN investors i ON i.id = t.investor_id
    WHERE t.type = 'sip'
      AND t.status IN ('rejected', 'failed')
      AND t.order_date IS NOT NULL
      AND t.created_at >= now() - interval '${since}'
      AND NOT EXISTS (
        SELECT 1 FROM sip_rejections sr
        WHERE sr.tenant_id = t.tenant_id AND sr.transaction_id = t.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sip_rejections sr
        WHERE sr.tenant_id = t.tenant_id
          AND sr.investor_id = t.investor_id
          AND sr.rejection_date = t.order_date::date
          AND sr.rejection_amount = t.amount
      )
    ON CONFLICT (tenant_id, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
    RETURNING 1
  `);
  return res.rows.length;
}

/** After an RTA import: best effort, never fails the import. */
export async function materialiseSipRejectionsAfterImport(tenantId: string | undefined): Promise<void> {
  if (!tenantId) return;
  try {
    await withTenant(tenantId, (tx) => materialiseSipRejectionRows(tx));
  } catch (e) {
    console.error("[sip-rejections] could not add rows after import:", (e as Error).message);
  }
}
