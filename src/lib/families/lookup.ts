/**
 * Families for a picker — a household and the members the viewer may open.
 *
 * Used where one person is chosen and the rest of the family should be one tap
 * away (a policy's life assured and nominees). Members are cut to the viewer's
 * own book (`investorScopeSql`), so a household that spans books never shows a
 * client the viewer cannot open, and a family with none visible is not listed.
 */
import { sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/jwt";
import { investorScopeSql } from "@/lib/investors/access";

export type FamilyMemberLite = {
  id: string;
  name: string;
  /** yyyy-mm-dd, or null */
  dob: string | null;
  /** Male / Female / Other, or null */
  gender: string | null;
  familyRole: string | null;
  isMinor: boolean;
  isHead: boolean;
};

export type FamilyLite = { id: string; name: string; code: string | null; members: FamilyMemberLite[] };

const GENDER: Record<string, string> = { M: "Male", F: "Female", O: "Other" };

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

async function membersOf(tx: Tx, session: SessionUser, familyIds: string[]): Promise<Map<string, FamilyMemberLite[]>> {
  const out = new Map<string, FamilyMemberLite[]>();
  if (!familyIds.length) return out;
  const scope = await investorScopeSql(tx, session, "i");
  const res = await tx.execute(sql`
    SELECT i.id, i.name, i.family_id, i.family_role, i.dob::text AS dob, i.gender, COALESCE(i.is_minor, false) AS is_minor,
           (f.primary_investor_id = i.id) AS is_head
      FROM investors i
      JOIN families f ON f.id = i.family_id
     WHERE i.tenant_id = ${session.tenantId}::uuid
       AND i.family_id IN (${sql.join(familyIds.map((x) => sql`${x}::uuid`), sql`, `)})
       AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND ${scope}
     ORDER BY (f.primary_investor_id = i.id) DESC, i.dob ASC NULLS LAST, i.name
  `);
  for (const r of res.rows) {
    const list = out.get(String(r.family_id)) ?? [];
    if (list.length >= 15) continue;
    list.push({
      id: String(r.id), name: String(r.name), dob: r.dob ?? null, gender: r.gender ? GENDER[String(r.gender)] ?? null : null,
      familyRole: r.family_role ?? null, isMinor: !!r.is_minor, isHead: !!r.is_head,
    });
    out.set(String(r.family_id), list);
  }
  return out;
}

/** The household this client belongs to, or null (no family, or nobody in it the viewer may open). */
export async function familyOfClient(tx: Tx, session: SessionUser, investorId: string): Promise<FamilyLite | null> {
  const scope = await investorScopeSql(tx, session, "i");
  const r = await tx.execute(sql`
    SELECT f.id, f.family_name, f.head_name, f.family_code
      FROM investors i JOIN families f ON f.id = i.family_id
     WHERE i.id = ${investorId}::uuid AND i.tenant_id = ${session.tenantId}::uuid AND i.deleted_at IS NULL AND ${scope}
     LIMIT 1
  `);
  const f = r.rows[0];
  if (!f) return null;
  const members = (await membersOf(tx, session, [String(f.id)])).get(String(f.id)) ?? [];
  return members.length ? { id: String(f.id), name: String(f.family_name ?? f.head_name ?? "Family"), code: f.family_code ?? null, members } : null;
}

/** Households matching a family name / code / head, or any visible member's name or PAN. */
export async function searchFamilies(tx: Tx, session: SessionUser, q: string): Promise<FamilyLite[]> {
  const scope = await investorScopeSql(tx, session, "mi");
  const like = `%${q}%`;
  const res = await tx.execute(sql`
    SELECT f.id, f.family_name, f.head_name, f.family_code
      FROM families f
     WHERE f.tenant_id = ${session.tenantId}::uuid
       AND (f.family_name ILIKE ${like} OR f.head_name ILIKE ${like} OR f.family_code ILIKE ${like}
            OR EXISTS (SELECT 1 FROM investors mi WHERE mi.family_id = f.id AND mi.deleted_at IS NULL AND mi.merged_into_id IS NULL
                         AND ${scope} AND (mi.name ILIKE ${like} OR mi.pan ILIKE ${`%${q.toUpperCase()}%`})))
       AND EXISTS (SELECT 1 FROM investors mi WHERE mi.family_id = f.id AND mi.deleted_at IS NULL AND mi.merged_into_id IS NULL AND ${scope})
     ORDER BY (f.family_name ILIKE ${`${q}%`}) DESC, f.family_name
     LIMIT 6
  `);
  const ids = res.rows.map((r) => String(r.id));
  const members = await membersOf(tx, session, ids);
  return res.rows
    .map((f) => ({ id: String(f.id), name: String(f.family_name ?? f.head_name ?? "Family"), code: f.family_code ?? null, members: members.get(String(f.id)) ?? [] }))
    .filter((f) => f.members.length > 0);
}
