/**
 * Family codes. Every family created in the CRM gets one automatically —
 * FAM-0001, FAM-0002 … per firm — so nobody invents a reference while
 * creating it (the firm's request, 2026-10-02).
 *
 * The next number is the firm's highest FAM-#### plus one. A code typed by
 * hand in another shape ("PATEL-001", from before codes were automatic) is
 * kept and never counted. The advisory lock holds a second create in the same
 * firm until the first one commits, so two families cannot share a code.
 */

import { sql } from "drizzle-orm";

const PREFIX = "FAM-";

/** 7 → "FAM-0007"; past 9999 it simply grows a digit. */
export function formatFamilyCode(n: number): string {
  return `${PREFIX}${String(Math.max(1, Math.floor(n))).padStart(4, "0")}`;
}

/** The number in an automatic code; null for anything else ("PATEL-001"). */
export function familyCodeNumber(code: string | null | undefined): number | null {
  const m = /^FAM-(\d{1,9})$/i.exec((code ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** The firm's next free code. Call inside the transaction that inserts the family. */
export async function nextFamilyCode(tx: any, tenantId: string): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:family-code`}, 0))`);
  const r = await tx.execute(sql`
    SELECT COALESCE(MAX(SUBSTRING(family_code FROM 5)::int), 0)::int AS n
      FROM families
     WHERE tenant_id = ${tenantId}::uuid
       AND family_code ~* '^FAM-[0-9]{1,9}$'
  `);
  return formatFamilyCode(Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0) + 1);
}
