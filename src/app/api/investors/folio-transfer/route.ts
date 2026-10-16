import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/investors/folio-transfer?ids=a,b — both clients with their folios
 *      (schemes, value, transactions, SIPs), for the transfer dialog.
 * POST /api/investors/folio-transfer — { fromId, toId, folioIds[], moveHistory,
 *      allowPanMismatch? } moves the chosen folios (and, by default, their
 *      transactions and SIPs) from one client to the other.
 *
 * Same gate as the merge: owner / branch head, both clients in their merge scope.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { allInMergeScope } from "@/lib/investors/merge";
import { loadTransferClients, transferFolios } from "@/lib/investors/folio-transfer";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));
const uuid = z.string().uuid();

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads can move folios" }, { status: 403 });
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean);
    if (ids.length !== 2 || !ids.every((i) => uuid.safeParse(i).success)) {
      return NextResponse.json({ error: "choose exactly two clients" }, { status: 400 });
    }
    const clients = await withTenant(
      session.tenantId,
      async (tx) => {
        if (!(await allInMergeScope(tx, session, ids))) return null;
        return loadTransferClients(tx, session.tenantId, ids);
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles },
    );
    if (!clients || clients.length !== 2) return NextResponse.json({ error: "client not found" }, { status: 404 });
    return NextResponse.json({ clients: ids.map((id) => clients.find((c) => c.id === id)!) });
  } catch (err: any) {
    return handleApiError(err);
  }
}

const Body = z.object({
  fromId: uuid,
  toId: uuid,
  folioIds: z.array(uuid).min(1).max(500),
  moveHistory: z.boolean().default(true),
  allowPanMismatch: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads can move folios" }, { status: 403 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        if (!(await allInMergeScope(tx, session, [b.fromId, b.toId]))) return { error: "client not found" };
        return transferFolios(tx, { tenantId: session.tenantId, ...b, byUserId: session.userId });
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles },
    );
    if ("error" in result) {
      return NextResponse.json(result, { status: (result as any).code === "pan_mismatch" ? 409 : result.error.includes("not found") ? 404 : 400 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
