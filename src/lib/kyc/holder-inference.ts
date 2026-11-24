/**
 * A client who holds units has had KYC accepted (2026-11-24, Akshar Invest: filtering Clients by
 * "KYC pending" listed people with crores invested).
 *
 * `investors.kyc_status` was set from a registrar CLIENT MASTER only ("KYC OK" / Kyc1Flag = Y);
 * a client first seen in a holdings, AUM or transaction file got the column default, 'pending',
 * and nothing ever moved it — so "pending" meant "no KYC information has reached us", not "KYC
 * not done". A fund house does not take an investment without KYC, so a client the registrar shows
 * holding units (or buying) is at least KRA-REGISTERED.
 *
 * What this does, and never does:
 *   · only 'pending' (or empty) becomes 'registered'; hold / rejected / expired / re-KYC / validated /
 *     verified are authoritative answers and are never touched;
 *   · the reason is written to kyc_status_remark and the source to kyc_check_source
 *     ('registrar_holdings'), kyc_checked_at stays empty — it is NOT a KRA check;
 *   · the NSE KRA check (lib/kyc/refresh.ts) still writes the exact status over it, and its
 *     nightly refresh asks clients up to "verified", so an inferred status is replaced by the real one.
 */
import { sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";

export const INFERRED_KYC_SOURCE = "registrar_holdings";
export const INFERRED_KYC_REMARK =
  "Holds units with the registrar - KYC was accepted when they invested (not yet checked with the KRA).";

/** Returns how many clients moved from pending to registered. */
export async function inferKycFromHoldings(tx: Tx, tenantId: string): Promise<number> {
  const res = await tx.execute(sql`
    UPDATE investors i
       SET kyc_status = 'registered',
           kyc_status_remark = ${INFERRED_KYC_REMARK},
           kyc_check_source = ${INFERRED_KYC_SOURCE},
           updated_at = now()
     WHERE i.tenant_id = ${tenantId}::uuid
       AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
       AND (i.kyc_status IS NULL OR i.kyc_status = 'pending')
       AND (
         COALESCE(i.aum, 0) > 0
         OR EXISTS (SELECT 1 FROM folios f WHERE f.tenant_id = i.tenant_id AND f.investor_id = i.id AND COALESCE(f.aum, 0) > 0)
         OR EXISTS (SELECT 1 FROM transactions t WHERE t.tenant_id = i.tenant_id AND t.investor_id = i.id
                      AND t.status = 'processed' AND t.type IN ('purchase', 'sip'))
       )
    RETURNING i.id
  `);
  return res.rows.length;
}

/** After an RTA import. Best effort — never fails the import. */
export async function inferKycFromHoldingsAfterImport(tenantId: string | null | undefined): Promise<void> {
  if (!tenantId) return;
  try {
    const n = await withTenant(tenantId, (tx) => inferKycFromHoldings(tx, tenantId), { roles: ["system"] });
    if (n) console.log(`[rta] ${n} client(s) who hold units marked KYC registered (inferred) for ${tenantId}`);
  } catch (e) {
    console.warn(`[rta] KYC inference from holdings failed for ${tenantId}:`, (e as Error)?.message);
  }
}
