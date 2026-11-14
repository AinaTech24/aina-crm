/**
 * PATCH /api/investors/[id]/cross-sell — change some products on the client's
 * Cross-sell card.
 *   { changes: { [product]: status | null } }   null clears that product
 *
 * Only the products sent are written, MERGED into what is on the record: the
 * card used to PUT its whole map back through the client PATCH, so a status
 * the server had changed since the page loaded (an opportunity opened, won or
 * lost) was silently overwritten by the stale copy.
 *
 * Same permission as editing the client (investor.edit.all, or the client's
 * own RM / a branch head for their branch with investor.edit.assigned).
 * Audited as investor.cross_sell with the before and after of each key.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { loadViewableInvestor } from "@/lib/investors/access";
import { CROSS_SELL_PRODUCT_KEYS, CROSS_SELL_STATUS_KEYS } from "@/lib/investors/cross-sell";

export const dynamic = "force-dynamic";

const Body = z.object({
  changes: z.record(
    z.string().refine((k) => (CROSS_SELL_PRODUCT_KEYS as readonly string[]).includes(k), "Unknown product"),
    z.string().refine((v) => (CROSS_SELL_STATUS_KEYS as readonly string[]).includes(v), "Unknown status").nullable(),
  ),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const changes = parsed.data.changes;
    if (!Object.keys(changes).length) return NextResponse.json({ ok: true, crossSell: null });

    const out = await withTenant(session.tenantId, async (tx) => {
      const inv = await loadViewableInvestor(tx, session, id);
      if (!inv) throw Object.assign(new Error("Not found"), { status: 404 });
      // Row rule of the client PATCH: without edit.all, only your own client
      // (a branch head: a client of their branch).
      if (!can(session.roles, "investor.edit.all", session.permissions)) {
        const branchScoped = !session.roles.includes("owner") && session.roles.includes("branch_head") && !!session.branchId;
        if (branchScoped ? inv.branchId !== session.branchId : inv.rmId !== session.userId) {
          throw Object.assign(new Error("You can change the Cross-sell card only for your own clients."), { status: 403 });
        }
      }
      const set: Record<string, string> = {};
      const clear: string[] = [];
      for (const [k, v] of Object.entries(changes)) {
        if (v == null) clear.push(k);
        else set[k] = v;
      }
      const before = ((inv as any).crossSell ?? {}) as Record<string, string>;
      const row = (await tx.execute(sql`
        UPDATE investors
           SET cross_sell = (COALESCE(cross_sell, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb)
                              - ${clear}::text[],
               updated_at = now()
         WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
         RETURNING cross_sell
      `)).rows[0] as { cross_sell: Record<string, string> | null } | undefined;
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "investor.cross_sell",
        entityType: "investor", entityId: id,
        before: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k] ?? null])),
        after: changes,
        ...clientMetaFromHeaders(req.headers),
      } as any);
      return row?.cross_sell ?? {};
    }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

    return NextResponse.json({ ok: true, crossSell: out });
  } catch (err) {
    return handleApiError(err);
  }
}
