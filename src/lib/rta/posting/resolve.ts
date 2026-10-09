/**
 * Manual resolution of a held economic transaction (Phase 3F) — the
 * auditable path for a person to decide what the import refused to guess.
 * DEVELOPMENT ONLY, behind the posting gate.
 *
 * Resolvable: a transaction held ONLY for ownership — its folio is not on
 * record ("owner_not_on_record"), an owner-rule exception (guardian / HUF /
 * PAN conflict / placeholder / ambiguous), or held as dependent on such a
 * transaction. Never resolvable here: a conflict with a different CRM
 * transaction under the same number, a registrar restatement, figures that
 * do not reconcile, or an unsupported code — those need the source fixed.
 *
 * The decision names a client. It is refused when:
 *   - the client is not live in this firm;
 *   - the folio is on record under a DIFFERENT client (nothing is ever
 *     reassigned — that is a Merge Clients / ownership change, audited there);
 *   - the row is a minor's and the client is that minor's recorded guardian,
 *     or the row is an HUF's and the client is an individual (the Karta).
 * A resolution posts the transaction once (posting ledger), records who
 * decided, why and when on the economic transaction AND in the audit log.
 */
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { CLASS_META, type RtaClass } from "../staging/classify";
import { assertPostingAllowed, registrarOutOfScope, reportOutOfScope } from "./gate";
import { registrarCovered, reportCovered } from "./controls";
import { recordOutcome } from "./post";
import { reprocessHeldTransactions } from "./reprocess";
import { panToken } from "../staging/pan-token";
import { validPan } from "../values";

type Tx = any;

const RESOLVABLE = /^(owner_not_on_record|folio_owner_conflict|folio_owned_by_guardian|owner_type_conflict|folio_pan_conflict|placeholder_owner|huf_owner_pan_unverified|pan_matches_minor_record|identity_blocked|identity_ambiguous|identity_split)\b/;

/** Can a person settle this hold by choosing a client? (The same rule the resolver enforces.) */
export function isResolvable(e: { posting_outcome: string | null; posting_reason: string | null; reason: string | null; status: string }): boolean {
  if (String(e.reason ?? "").startsWith("instalment_rejected")) return false;
  if (e.posting_outcome === "held_dependent") return true;
  const ex = String(e.posting_reason ?? e.reason ?? "");
  if (e.posting_outcome !== "quarantined" || !RESOLVABLE.test(ex) || !["complete", "duplicate", "quarantined"].includes(e.status)) return false;
  return e.status !== "quarantined" || RESOLVABLE.test(String(e.reason ?? ""));
}

export class ResolutionError extends Error {
  status = 409;
}

export async function resolveHeldTransaction(
  tenantId: string,
  economicTxnId: string,
  decision: { investorId: string; note: string; userId: string },
): Promise<{ transactionId: string }> {
  if (!decision.note?.trim()) throw new ResolutionError("a reason for the decision is required");
  const done = await withTenant(tenantId, async (tx: Tx) => {
    const scope = await assertPostingAllowed(tx, tenantId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"rta_posting:" + tenantId}, 0))`);
    const e = (await tx.execute(sql`
      SELECT e.id, e.batch_id, e.identity_key, e.rta, e.amc_code, e.folio_number, e.scheme_code, e.registrar_txn_no, e.trade_date::text AS trade_date,
             e.rta_class, e.direction, e.status, e.reason, e.lot_count, e.reported_units::text AS units, e.reported_amount::text AS amount,
             e.reported_nav::text AS nav, e.posting_outcome, e.posting_reason,
             (SELECT r.attrs FROM rta_staging_rows r WHERE r.tenant_id = e.tenant_id AND r.economic_txn_id = e.id ORDER BY r.row_no LIMIT 1) AS attrs,
             (SELECT r.pan_token FROM rta_staging_rows r WHERE r.tenant_id = e.tenant_id AND r.economic_txn_id = e.id ORDER BY r.row_no LIMIT 1) AS pan_token
        FROM rta_staging_economic_txns e WHERE e.tenant_id = ${tenantId}::uuid AND e.id = ${economicTxnId}::uuid FOR UPDATE`)).rows[0] as any;
    if (!e) throw Object.assign(new ResolutionError("not found"), { status: 404 });
    if (!registrarCovered(scope, e.rta)) throw new ResolutionError(registrarOutOfScope(scope.registrars, e.rta));
    const eb = (await tx.execute(sql`SELECT report_code FROM rta_staging_batches WHERE tenant_id = ${tenantId}::uuid AND id = ${e.batch_id}::uuid`)).rows[0] as { report_code: string | null } | undefined;
    if (!reportCovered(scope, eb?.report_code)) throw new ResolutionError(reportOutOfScope(scope.reportCodes, eb?.report_code));
    const ledger = (await tx.execute(sql`SELECT 1 FROM rta_posted_transactions WHERE tenant_id = ${tenantId}::uuid AND identity_key = ${e.identity_key}`)).rows;
    if (ledger.length) throw new ResolutionError("this registrar transaction is already posted");
    // A refused instruction is never posted as an investment by choosing a client.
    if (String(e.reason ?? "").startsWith("instalment_rejected")) {
      throw new ResolutionError("this is a refused instruction — it is recorded as a rejection by re-importing the file once its folio is on record, never posted as an investment here");
    }
    const ex = String(e.posting_reason ?? e.reason ?? "");
    if (!isResolvable(e)) throw new ResolutionError(`this transaction is held for "${ex.split(":")[0] || e.posting_outcome}", which is not an ownership question — it cannot be resolved by choosing a client`);

    const inv = (await tx.execute(sql`SELECT id, pan, is_minor, investor_category, deleted_at, merged_into_id FROM investors WHERE tenant_id = ${tenantId}::uuid AND id = ${decision.investorId}::uuid`)).rows[0] as any;
    if (!inv || inv.deleted_at || inv.merged_into_id) throw new ResolutionError("the chosen client is not a live client of this firm");
    const holder = (e.attrs?.holder ?? {}) as { ownerType?: string };
    if (holder.ownerType === "minor" && !inv.is_minor) {
      const guards = (await tx.execute(sql`SELECT 1 FROM investors WHERE tenant_id = ${tenantId}::uuid AND guardian_investor_id = ${inv.id}::uuid LIMIT 1`)).rows.length;
      throw new ResolutionError(guards ? "the row is a minor's and the chosen client is a guardian — a guardian is never the owner" : "the row is a minor's and the chosen client is not a minor");
    }
    if (holder.ownerType === "huf" && inv.investor_category !== "huf") throw new ResolutionError("the row is an HUF's and the chosen client is not an HUF — a Karta is never the owner");
    // The registrar names the owner's own PAN and the chosen client has a different one: refused.
    const clientPan = validPan(inv.pan);
    if (holder.ownerType !== "minor" && e.pan_token && clientPan && panToken(tenantId, clientPan) !== e.pan_token) {
      throw new ResolutionError("the registrar reports a different PAN for this owner than the chosen client's — choose the client holding that PAN, or correct the client record first");
    }

    const folio = (await tx.execute(sql`SELECT id, investor_id FROM folios WHERE tenant_id = ${tenantId}::uuid AND amc_code = ${e.amc_code} AND folio_number = ${e.folio_number}`)).rows[0] as any;
    if (folio && String(folio.investor_id) !== String(inv.id)) throw new ResolutionError("the folio is on record under a different client — nothing is reassigned here (use Merge Clients or an ownership change)");
    let folioId = folio?.id ? String(folio.id) : null;
    if (!folioId) {
      folioId = String((await tx.execute(sql`INSERT INTO folios (tenant_id, investor_id, folio_number, amc_code, amc_name, rta) VALUES (${tenantId}::uuid, ${inv.id}::uuid, ${e.folio_number}, ${e.amc_code}, ${e.amc_code}, ${e.rta}) RETURNING id`)).rows[0].id);
    }
    const existing = (await tx.execute(sql`SELECT id FROM transactions WHERE tenant_id = ${tenantId}::uuid AND order_id = ${e.registrar_txn_no}`)).rows;
    if (existing.length) throw new ResolutionError("the CRM already holds a transaction under this registrar number — resolve that conflict first");
    const type = CLASS_META[e.rta_class as RtaClass]?.legacyType;
    if (!type || !e.direction) throw new ResolutionError(`class ${e.rta_class} has no CRM transaction type`);
    const lineage = { pipeline: "validate_first", identityKey: e.identity_key, batchId: e.batch_id, economicTxnId: e.id, lotCount: e.lot_count, resolvedBy: decision.userId, amountMeaning: "registrar_reported", payoutVerified: false };
    const t = (await tx.execute(sql`
      INSERT INTO transactions (tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, scheme_name, type, direction, amount, units, nav,
        order_id, order_date, status, source_feed, raw_feed_row, dedup_key)
      VALUES (${tenantId}::uuid, ${inv.id}::uuid, ${folioId}::uuid, ${e.folio_number}, ${e.amc_code}, ${e.amc_code}, ${e.scheme_code}, ${String(e.attrs?.schemeName ?? e.scheme_code)},
        ${type}, ${e.direction}, ${Math.abs(Number(e.amount))}, ${Math.abs(Number(e.units ?? 0))}, ${e.nav}, ${e.registrar_txn_no}, ${e.trade_date}::date, 'processed',
        'rta_validate_first', ${JSON.stringify(lineage)}::jsonb, ${e.identity_key})
      RETURNING id`)).rows[0] as { id: string };
    await tx.execute(sql`
      INSERT INTO rta_posted_transactions (tenant_id, identity_key, economic_txn_id, batch_id, kind, transaction_id, posted_by)
      VALUES (${tenantId}::uuid, ${e.identity_key}, ${e.id}::uuid, ${e.batch_id}::uuid, 'posted_new', ${t.id}::uuid, ${decision.userId}::uuid)`);
    const reason = `manually resolved: ${decision.note.trim().slice(0, 300)}`;
    await tx.execute(sql`UPDATE rta_staging_economic_txns SET match_investor_id = ${inv.id}::uuid, match_folio_id = ${folioId}::uuid WHERE tenant_id = ${tenantId}::uuid AND id = ${e.id}::uuid`);
    await recordOutcome(tx, tenantId, e.id, "posted", reason, { by: decision.userId, via: "manual_resolution", extra: { investorId: inv.id, folioId } });
    // Written directly, not through recordAudit (which swallows a failed
    // insert): a resolution that cannot be audited does not happen.
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after, reason)
      VALUES (${tenantId}::uuid, ${decision.userId}::uuid, 'user', 'rta.identity.resolve', 'rta_economic_transaction', ${e.id}::uuid,
              ${JSON.stringify({ postingOutcome: e.posting_outcome, heldFor: ex.split(":")[0] })}::jsonb,
              ${JSON.stringify({ investorId: inv.id, folioId, transactionId: t.id })}::jsonb, ${decision.note.trim().slice(0, 500)})`);
    return { transactionId: t.id, amcCode: e.amc_code as string | null, folioNumber: e.folio_number as string };
  });
  // The folio's other transactions held only because this one was (held_dependent) can follow now.
  await reprocessHeldTransactions(tenantId, { folios: [{ amcCode: done.amcCode, folioNumber: done.folioNumber }], userId: decision.userId });
  return { transactionId: done.transactionId };
}
