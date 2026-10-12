/**
 * The validate-first exception list (Phase 3F): every registrar transaction
 * the import refused to post, with why, and whether a person can settle it by
 * choosing a client. One row per registrar transaction (its latest staging),
 * never one already in the posting ledger. Read-only; PANs never appear (the
 * reasons are masked again on the way out).
 */
import { sql } from "drizzle-orm";
import { maskPansIn } from "../exceptions";
import { isResolvable } from "./resolve";

type Tx = any;

export const HELD_OUTCOMES = ["quarantined", "unsupported", "correction_held", "held_dependent", "blocked"] as const;
export type HeldOutcome = (typeof HELD_OUTCOMES)[number];

export type HeldTransaction = {
  id: string;
  rta: string;
  folio: string;
  scheme: string | null;
  tradeDate: string | null;
  rtaClass: string;
  amount: number | null;
  lots: number;
  outcome: HeldOutcome;
  heldFor: string;
  reason: string;
  fileName: string | null;
  stagedAt: string;
  resolvable: boolean;
};

export async function loadHeldTransactions(tx: Tx, tenantId: string, opts: { limit?: number; outcome?: HeldOutcome } = {}): Promise<{ rows: HeldTransaction[]; counts: Record<HeldOutcome, number>; total: number }> {
  const rows = (await tx.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (e.identity_key) e.*
        FROM rta_staging_economic_txns e
        JOIN rta_staging_batches b ON b.tenant_id = e.tenant_id AND b.id = e.batch_id AND b.mode = 'validate_first'
       WHERE e.tenant_id = ${tenantId}::uuid AND e.posting_outcome IS NOT NULL
       ORDER BY e.identity_key, e.created_at DESC
    )
    SELECT l.id::text AS id, l.rta, l.folio_number, l.scheme_code, l.trade_date::text AS trade_date, l.rta_class, l.reported_amount::text AS amount,
           l.lot_count, l.posting_outcome, l.posting_reason, l.reason, l.status, b.file_name, l.created_at::text AS staged_at
      FROM latest l
      JOIN rta_staging_batches b ON b.id = l.batch_id
     WHERE l.posting_outcome IN ('quarantined', 'unsupported', 'correction_held', 'held_dependent', 'blocked')
       AND NOT EXISTS (SELECT 1 FROM rta_posted_transactions p WHERE p.tenant_id = l.tenant_id AND p.identity_key = l.identity_key)
     ORDER BY l.trade_date DESC NULLS LAST, l.identity_key
  `)).rows as Array<Record<string, any>>;
  const counts = Object.fromEntries(HELD_OUTCOMES.map((o) => [o, 0])) as Record<HeldOutcome, number>;
  for (const r of rows) counts[r.posting_outcome as HeldOutcome]++;
  const list = rows
    .filter((r) => !opts.outcome || r.posting_outcome === opts.outcome)
    .slice(0, opts.limit ?? 500)
    .map((r): HeldTransaction => {
      const why = String(r.posting_reason ?? r.reason ?? "");
      return {
        id: r.id, rta: r.rta, folio: r.folio_number, scheme: r.scheme_code, tradeDate: r.trade_date, rtaClass: r.rta_class,
        amount: r.amount == null ? null : Math.abs(Number(r.amount)), lots: Number(r.lot_count ?? 1),
        outcome: r.posting_outcome, heldFor: why.split(":")[0].trim() || r.posting_outcome,
        reason: maskPansIn(why.includes(":") ? why.slice(why.indexOf(":") + 1).trim() : why),
        fileName: r.file_name ? maskPansIn(r.file_name) : null, stagedAt: r.staged_at,
        resolvable: isResolvable(r as any),
      };
    });
  return { rows: list, counts, total: rows.length };
}
