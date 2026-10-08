import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/practice/positions — every position with holders, processes and SOPs
 * POST /api/practice/positions — create { title, purpose?, results?, approvals? }
 *      The key is the title's slug, made unique within the firm.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { practicePositions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { PositionCreateBody, loadPositions, positionKey, takenPositionKeys, uniqueKey } from "@/lib/practice/positions";
import { gateManage, gateView, tenantOpts } from "./_gate";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    gateView(session);
    const positions = await withTenant(session.tenantId, (tx) => loadPositions(tx, session.tenantId), tenantOpts(session));
    return NextResponse.json({ positions });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    require(session.roles, "settings.users", session.permissions);
    gateManage(session);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = PositionCreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;
    const position = await withTenant(session.tenantId, async (tx) => {
      const taken = await takenPositionKeys(tx, session.tenantId);
      // Appended after the last position.
      const maxSort = await tx.execute(
        sql`SELECT COALESCE(MAX(sort), 0)::int AS s FROM practice_positions WHERE tenant_id = ${session.tenantId}::uuid`,
      );
      const sort = Number((maxSort.rows[0] as { s?: number } | undefined)?.s ?? 0) + 10;
      const [row] = await tx.insert(practicePositions).values({
        tenantId: session.tenantId,
        key: uniqueKey(positionKey(b.title), taken),
        title: b.title,
        purpose: b.purpose || null,
        results: b.results ?? [],
        approvals: b.approvals ?? [],
        sort,
      }).returning();
      return row;
    }, tenantOpts(session));
    return NextResponse.json({ position }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
