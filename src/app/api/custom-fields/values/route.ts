/**
 * PATCH /api/custom-fields/values  { entity, recordId, values }
 *   Save MFD custom-field values onto a lead or client. Values are validated
 *   against the firm's field definitions (unknown keys dropped, coerced by type)
 *   and stored in the record's `custom_fields` jsonb. Respects the same edit
 *   permission as the record itself.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { leads, investors } from "@/db/schema";
import { loadEditableLead } from "@/lib/leads/access";
import { loadCustomFieldDefs, sanitizeCustomFields } from "@/lib/custom-fields/values";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const Body = z.object({
  entity: z.enum(["lead", "investor"]),
  recordId: z.string().uuid(),
  values: z.record(z.string(), z.any()).default({}),
});

export async function POST(req: NextRequest) { return PATCH(req); }

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { entity, recordId, values } = parse.data;

    if (entity === "lead") requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    else requireCap(session.roles, "investor.edit.all");

    const result = await withTenant(session.tenantId, async (tx) => {
      // Sanitize against the firm's definitions for this entity.
      const defs = await loadCustomFieldDefs(tx, session.tenantId, entity);
      const clean = sanitizeCustomFields(defs, values);

      if (entity === "lead") {
        // Enforces the caller can edit THIS lead (branch / ownership scoping).
        await loadEditableLead(tx, session, recordId);
        await tx.update(leads).set({ customFields: clean, updatedAt: new Date() } as any).where(eq(leads.id, recordId));
      } else {
        const [inv] = await tx.select({ id: investors.id }).from(investors).where(eq(investors.id, recordId)).limit(1);
        if (!inv) throw Object.assign(new Error("client not found"), { status: 404 });
        await tx.update(investors).set({ customFields: clean, updatedAt: new Date() } as any).where(eq(investors.id, recordId));
      }
      return clean;
    });

    return NextResponse.json({ ok: true, customFields: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
