import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";

/** Minimal contact index for matching on the handset. Unknown calls stay local. */
export async function GET() {
  try {
    const s = await requireSession();
    const firm = s.roles.some(r => ["owner", "ops", "back_office"].includes(r));
    const branch = !firm && s.roles.includes("branch_head");
    if (!firm && !branch && !s.roles.includes("rm")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const contacts = await withTenant(s.tenantId, async tx => {
      const scope = (owner: string) => firm ? sql`TRUE` : branch
        ? (s.branchId ? sql`branch_id = ${s.branchId}::uuid` : sql`FALSE`)
        : sql`${sql.raw(owner)} = ${s.userId}::uuid`;
      const result = await tx.execute(sql`
        SELECT id, name, phone, 'investor' AS "subjectType" FROM investors
        WHERE tenant_id = ${s.tenantId}::uuid AND phone IS NOT NULL AND deleted_at IS NULL AND ${scope("rm_id")}
        UNION ALL
        SELECT id, name, phone, 'lead' AS "subjectType" FROM leads
        WHERE tenant_id = ${s.tenantId}::uuid AND phone IS NOT NULL AND converted_investor_id IS NULL
          AND lost_reason IS DISTINCT FROM '__deleted__' AND ${scope("owner_id")}
      `);
      return result.rows;
    }, { userId: s.userId, branchId: s.branchId, roles: s.roles });
    return NextResponse.json({ contacts });
  } catch (e) { return handleApiError(e); }
}
