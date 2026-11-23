import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/families/bulk — apply one change to many families at once.
 *
 * Body: { ids: string[], action, field?, value? }
 *   action = "assign"  value = rmId (uuid) | null   → the family's RM (and its members')
 *          = "review"  value = YYYY-MM-DD            → next review date
 *          = "field"   field = a key of lib/families/bulk-fields, value = the
 *                      new value (null clears)       → "Update a field"
 *
 * Who may: the same people who may edit one family (requireFamilyEdit), and
 * only families they can see (familyScopeSql) — a capability is not a licence
 * to act outside one's book. At most FAMILY_BULK_MAX families per request.
 * Every changed family gets its own audit row (family.bulk_field).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { clientMetaFromHeaders } from "@/lib/audit";
import { familyScopeSql, requireFamilyEdit } from "@/lib/families/access";
import { applyFamilyBulkField, FamilyBulkError } from "@/lib/families/bulk-update";
import { FAMILY_BULK_MAX } from "@/lib/families/bulk-fields";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1),
  action: z.enum(["assign", "review", "field"]),
  /** field only: which registry field to set (lib/families/bulk-fields). */
  field: z.string().max(40).optional(),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireFamilyEdit(session);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    if (ids.length > FAMILY_BULK_MAX) {
      return NextResponse.json(
        { error: `Update at most ${FAMILY_BULK_MAX.toLocaleString("en-IN")} families at a time — you selected ${ids.length.toLocaleString("en-IN")}.` },
        { status: 400 }
      );
    }
    const field = action === "assign" ? "rm" : action === "review" ? "nextReview" : parsed.data.field;
    if (!field) return NextResponse.json({ error: "field required" }, { status: 400 });
    if (action === "review" && !value) return NextResponse.json({ error: "value (date) required" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    try {
      const result = await withTenant(session.tenantId, async (tx) => {
        // Only families this person can see are touched.
        const scope = await familyScopeSql(tx, session, "f");
        const visible = (await tx.execute(sql`
          SELECT f.id FROM families f
           WHERE f.tenant_id = ${session.tenantId}::uuid
             AND f.id IN (${sql.join([...new Set(ids)].map((id) => sql`${id}::uuid`), sql`, `)})
             AND ${scope}
        `)).rows as Array<{ id: string }>;
        if (visible.length === 0) throw new FamilyBulkError("None of the selected families are in your book.");
        const r = await applyFamilyBulkField(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          ids: visible.map((v) => String(v.id)),
          field,
          value,
          clientMeta: meta,
        });
        return { ...r, notVisible: new Set(ids).size - visible.length };
      });
      return NextResponse.json({ ok: true, updated: result.updated, unchanged: result.unchanged, notVisible: result.notVisible });
    } catch (e) {
      if (e instanceof FamilyBulkError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
