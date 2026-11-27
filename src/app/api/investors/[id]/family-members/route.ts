/**
 * GET /api/investors/[id]/family-members — the client and the other members of
 * their family, for the New task form's request table (a row can be for any
 * of them). Only members the caller can open are listed; a client with no
 * family returns just themselves.
 *
 *   200 { familyId, familyName, members: [{ id, name, role, isSelf }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { investorScopeSql, loadViewableInvestor } from "@/lib/investors/access";
import { roleLabel } from "@/lib/families/roles";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const out = await withTenant(
      session.tenantId,
      async (tx) => {
        const self = await loadViewableInvestor(tx, session, id);
        if (!self) return null;
        const one = { id: self.id, name: self.name, role: roleLabel(self.familyRole), isSelf: true };
        if (!self.familyId) return { familyId: null, familyName: null, members: [one] };
        const scope = await investorScopeSql(tx, session, "i");
        const rows = (
          await tx.execute(sql`
            SELECT i.id, i.name, i.family_role, f.family_name AS family_name, (f.primary_investor_id = i.id) AS is_head
              FROM investors i
              JOIN families f ON f.id = i.family_id
             WHERE i.tenant_id = ${session.tenantId}::uuid
               AND i.family_id = ${self.familyId}::uuid
               AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
               AND ${scope}
             ORDER BY (f.primary_investor_id = i.id) DESC, i.name`)
        ).rows as Array<{ id: string; name: string; family_role: string | null; family_name: string | null; is_head: boolean }>;
        const members = rows.map((r) => ({ id: r.id, name: r.name, role: roleLabel(r.family_role), isSelf: r.id === self.id }));
        if (!members.some((m) => m.isSelf)) members.unshift(one);
        return { familyId: self.familyId, familyName: rows[0]?.family_name ?? null, members };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles },
    );
    if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}
