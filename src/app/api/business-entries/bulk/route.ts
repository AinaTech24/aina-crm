import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/business-entries/bulk — apply one action to many entries at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "status"   value = draft|confirmed|emailed|cancelled
 *          = "assign"   value = userId (uuid) — reassigns the RM
 *          = "delete"   (no value) → hard delete, cascading the entry lines
 *
 * RBAC: same manage roles as the single-entry route. Tenant-scoped via RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { businessEntries, businessEntryLines, users } from "@/db/schema";
import { BUSINESS_ENTRY_STATUSES } from "@/db/schema/business_entries";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const canManage = (roles: string[]) => roles.some((r) => MANAGE_ROLES.includes(r));

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["status", "assign", "delete"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const count = await withTenant(session.tenantId, async (tx) => {
      const where = and(eq(businessEntries.tenantId, session.tenantId), inArray(businessEntries.id, ids));
      let n: number;

      if (action === "delete") {
        // Lines first (no ON DELETE CASCADE on the FK), then the entries.
        await tx.delete(businessEntryLines).where(inArray(businessEntryLines.entryId, ids));
        const del = await tx.delete(businessEntries).where(where).returning({ id: businessEntries.id });
        n = del.length;
      } else {
        const patch: Record<string, any> = { updatedAt: new Date() };
        if (action === "status") {
          if (!value || !(BUSINESS_ENTRY_STATUSES as readonly string[]).includes(value)) {
            throw Object.assign(new Error("invalid status"), { status: 400 });
          }
          patch.status = value;
        } else if (action === "assign") {
          if (!value) throw Object.assign(new Error("value (userId) required"), { status: 400 });
          const [u] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, value), eq(users.tenantId, session.tenantId)))
            .limit(1);
          if (!u) throw Object.assign(new Error("RM not found in this firm"), { status: 400 });
          patch.rmId = value;
        }
        const upd = await tx.update(businessEntries).set(patch).where(where).returning({ id: businessEntries.id });
        n = upd.length;
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `business_entry.bulk_${action}`,
        entityType: "business_entry",
        entityId: ids[0],
        after: { ids, action, value: value ?? null, count: n } as any,
        ...meta,
      }).catch(() => {});

      return n;
    });

    return NextResponse.json({ ok: true, count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
