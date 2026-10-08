import { handleApiError } from "@/lib/api/error-handler";
/**
 * PUT /api/practice/positions/[id]/holders — replace the holders { userIds: uuid[] }.
 * Every id must be an active user of the firm; an empty list leaves the position vacant.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { practicePositions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { PositionHoldersBody, activeTenantUsers, replaceHolders } from "@/lib/practice/positions";
import { gateManage, tenantOpts } from "../../_gate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const session = await requireSession();
    require(session.roles, "settings.users", session.permissions);
    gateManage(session);
    await assertActiveLicense(session.tenantId, session.roles);
    if (!UUID.test(id)) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    const parse = PositionHoldersBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const userIds = [...new Set(parse.data.userIds.map((u) => u.toLowerCase()))];
    const out = await withTenant(session.tenantId, async (tx) => {
      const [position] = await tx.select({ id: practicePositions.id }).from(practicePositions)
        .where(and(eq(practicePositions.id, id), eq(practicePositions.tenantId, session.tenantId)));
      if (!position) return { error: "Position not found", status: 404 } as const;
      const valid = await activeTenantUsers(tx, session.tenantId, userIds);
      if (valid.length !== userIds.length) return { error: "Only active team members can hold a position", status: 400 } as const;
      await replaceHolders(tx, session.tenantId, id, userIds);
      return { ok: true } as const;
    }, tenantOpts(session));
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true, userIds });
  } catch (err) {
    return handleApiError(err);
  }
}
