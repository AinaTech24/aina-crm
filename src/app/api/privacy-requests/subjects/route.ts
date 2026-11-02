/**
 * GET /api/privacy-requests/subjects?q=… — clients and leads a privacy request
 * may be about, by name, phone, email or PAN. Firm-wide: the compliance officer
 * answers for every client. Needs `compliance.view`. Up to 8 of each.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

type Row = { id: string; name: string; email: string | null; phone: string | null };

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.view", session.permissions);
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ hits: [] });
    const like = `%${q}%`;
    const prefix = `${q}%`;
    const hits = await withTenant(session.tenantId, async (tx) => {
      const clients = await tx.execute(sql`
        SELECT i.id::text AS id, i.name, i.email, i.phone FROM investors i
         WHERE i.tenant_id = ${session.tenantId}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
           AND (i.name ILIKE ${like} OR i.phone ILIKE ${like} OR i.email ILIKE ${like} OR i.pan ILIKE ${like.toUpperCase()})
         ORDER BY (i.name ILIKE ${prefix}) DESC, i.name LIMIT 8`);
      const leadRows = await tx.execute(sql`
        SELECT l.id::text AS id, l.name, l.email, l.phone FROM leads l
         WHERE l.tenant_id = ${session.tenantId}::uuid AND l.converted_investor_id IS NULL
           AND l.lost_reason IS DISTINCT FROM '__deleted__'
           AND (l.name ILIKE ${like} OR l.phone ILIKE ${like} OR l.email ILIKE ${like})
         ORDER BY (l.name ILIKE ${prefix}) DESC, l.name LIMIT 8`);
      return [
        ...(clients.rows as Row[]).map((r) => ({ type: "investor" as const, ...r })),
        ...(leadRows.rows as Row[]).map((r) => ({ type: "lead" as const, ...r })),
      ];
    });
    return NextResponse.json({ hits });
  } catch (err) {
    return handleApiError(err);
  }
}
