/**
 * Universal claim search (§54) and the names the page needs. Search reaches
 * every claim in the viewer's scope, open or closed, by what the CRM holds:
 * client or proposer name, policy number, mobile, PAN, company (a corporate
 * client's name), insurer, vehicle number, and the RM or owner's name. There
 * is no claim-number or hospital field to search.
 */

import { sql } from "drizzle-orm";
import { num, str, type ClaimScope, type Row, type Tx } from "./window";

export type ClaimHit = { id: string; client: string; status: string; claimed: number; insurer: string | null; policyNumber: string | null; openedOn: string; matched: string };

export async function searchClaims(tx: Tx, tenantId: string, scope: ClaimScope, q: string): Promise<ClaimHit[]> {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const digits = term.replace(/\D/g, "");
  const phoneLike = digits.length >= 4 ? `%${digits}%` : null;
  const rows = (await tx.execute(sql`
    SELECT c.id::text AS id, COALESCE(i.name, c.proposer_name) AS client, c.claim_status, COALESCE(c.claimed_amount, 0) AS claimed,
           NULLIF(btrim(COALESCE(c.insurer, p.insurer, '')), '') AS insurer,
           NULLIF(btrim(COALESCE(c.policy_number, p.policy_number, '')), '') AS policy_number,
           COALESCE(c.intimation_date, (c.created_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS opened_on,
           CASE
             WHEN COALESCE(i.name, c.proposer_name) ILIKE ${like} OR c.proposer_name ILIKE ${like} THEN 'Client'
             WHEN COALESCE(c.policy_number, p.policy_number, '') ILIKE ${like} THEN 'Policy number'
             WHEN upper(COALESCE(i.pan, '')) = upper(${term}) THEN 'PAN'
             WHEN COALESCE(c.insurer, p.insurer, '') ILIKE ${like} THEN 'Insurer'
             WHEN COALESCE(p.details->>'vehicleRegNo', '') ILIKE ${like} THEN 'Vehicle number'
             WHEN ${phoneLike}::text IS NOT NULL AND (regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE ${phoneLike}
                  OR regexp_replace(COALESCE(i.phone, ''), '\\D', '', 'g') LIKE ${phoneLike}) THEN 'Mobile'
             WHEN ou.name ILIKE ${like} THEN 'Owner'
             WHEN ru.name ILIKE ${like} THEN 'RM'
             ELSE 'Match'
           END AS matched
      FROM insurance_claims c
      LEFT JOIN insurance_policies p ON p.id = c.policy_id AND p.tenant_id = c.tenant_id
      LEFT JOIN investors i ON i.id = c.investor_id AND i.tenant_id = c.tenant_id
      LEFT JOIN users ou ON ou.id = c.rm_id
      LEFT JOIN users ru ON ru.id = i.rm_id
     WHERE c.tenant_id = ${tenantId}::uuid
       ${scope.kind === "branch" ? sql`AND COALESCE(i.branch_id, c.branch_id) = ${scope.branchId}::uuid` : sql``}
       ${scope.kind === "self" ? sql`AND (i.rm_id = ${scope.userId}::uuid OR c.rm_id = ${scope.userId}::uuid)` : sql``}
       AND (
         COALESCE(i.name, c.proposer_name) ILIKE ${like} OR c.proposer_name ILIKE ${like}
         OR COALESCE(c.policy_number, p.policy_number, '') ILIKE ${like}
         OR upper(COALESCE(i.pan, '')) = upper(${term})
         OR COALESCE(c.insurer, p.insurer, '') ILIKE ${like}
         OR COALESCE(p.details->>'vehicleRegNo', '') ILIKE ${like}
         OR (${phoneLike}::text IS NOT NULL AND (regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE ${phoneLike}
              OR regexp_replace(COALESCE(i.phone, ''), '\\D', '', 'g') LIKE ${phoneLike}))
         OR ou.name ILIKE ${like} OR ru.name ILIKE ${like}
       )
     ORDER BY (c.claim_status IN ('settled_fully', 'settled_partially', 'rejected', 'withdrawn')), c.updated_at DESC
     LIMIT 25
  `)).rows as Row[];
  return rows.map((r) => ({
    id: String(r.id), client: String(r.client ?? "—"), status: String(r.claim_status), claimed: num(r.claimed), insurer: str(r.insurer),
    policyNumber: str(r.policy_number), openedOn: String(r.opened_on), matched: String(r.matched),
  }));
}

/** Users and branches by id — every name the page prints — plus the pickers' options. */
export async function loadClaimNames(tx: Tx, tenantId: string) {
  const users = (await tx.execute(sql`
    SELECT id::text AS id, name, status, roles FROM users WHERE tenant_id = ${tenantId}::uuid ORDER BY name
  `)).rows as Array<{ id: string; name: string; status: string | null; roles: string[] | null }>;
  const branches = (await tx.execute(sql`
    SELECT id::text AS id, name FROM branches WHERE tenant_id = ${tenantId}::uuid ORDER BY name
  `)).rows as Array<{ id: string; name: string }>;
  const insurers = (await tx.execute(sql`
    SELECT lower(btrim(COALESCE(c.insurer, p.insurer))) AS k, mode() WITHIN GROUP (ORDER BY btrim(COALESCE(c.insurer, p.insurer))) AS name
      FROM insurance_claims c LEFT JOIN insurance_policies p ON p.id = c.policy_id
     WHERE c.tenant_id = ${tenantId}::uuid AND NULLIF(btrim(COALESCE(c.insurer, p.insurer, '')), '') IS NOT NULL
     GROUP BY 1 ORDER BY 2 LIMIT 200
  `)).rows as Array<{ k: string; name: string }>;
  return {
    userName: new Map(users.map((u) => [u.id, u.name])),
    branchName: new Map(branches.map((b) => [b.id, b.name])),
    /** People a claim can be owned by or a follow-up assigned to: active staff. */
    staff: users.filter((u) => u.status !== "offboarded" && !(u.roles ?? []).includes("investor")).map((u) => ({ value: u.id, label: u.name })),
    branches: branches.map((b) => ({ value: b.id, label: b.name })),
    insurers: insurers.map((i) => ({ value: i.k, label: i.name })),
  };
}
