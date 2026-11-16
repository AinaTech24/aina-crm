import { handleApiError } from "@/lib/api/error-handler";
/**
 * The firm's Zoho client fields (lib/imports/zoho/fields.ts).
 *   GET  — how many of them the firm already has.
 *   POST — create the missing ones now (and make Lead Source / Salutation
 *          picklists), so the client form shows them before any import.
 * Only for a firm with the "Zoho CRM import" flag.
 */
import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { assertZohoImport } from "@/lib/imports/zoho/access";
import { ensureZohoClientFields, zohoClientFieldsPresent } from "@/lib/imports/zoho/fields";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    await assertZohoImport(session, "contacts");
    return NextResponse.json(await withTenant(session.tenantId, (tx) => zohoClientFieldsPresent(tx, session.tenantId)));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST() {
  try {
    const session = await requireSession();
    await assertZohoImport(session, "contacts");
    requireCap(session.roles, "investor.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const out = await withTenant(
      session.tenantId,
      async (tx) => {
        const r = await ensureZohoClientFields(tx, session.tenantId, session.userId);
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "custom_field.zoho_setup",
          entityType: "custom_field_def",
          entityId: null,
          meta: { created: r.created },
        });
        return { created: r.created, ...(await zohoClientFieldsPresent(tx, session.tenantId)) };
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
    );
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}
