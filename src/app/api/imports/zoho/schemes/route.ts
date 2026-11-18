import { handleApiError } from "@/lib/api/error-handler";
/**
 * Map Zoho business scheme names to the firm's Scheme Master
 * (lib/imports/zoho/run-schemes.ts). Only for a firm with the "Zoho CRM import"
 * flag.
 *   GET  — every unmapped name with the matcher's suggestion.
 *   POST — { mappings: [{ name, schemeCode }] } the names a person confirmed.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertZohoImport } from "@/lib/imports/zoho/access";
import { applySchemeMapping, previewSchemeMapping } from "@/lib/imports/zoho/run-schemes";

export const dynamic = "force-dynamic";

const Body = z.object({
  mappings: z.array(z.object({ name: z.string().min(1).max(300), schemeCode: z.string().min(1).max(40) })).min(1).max(5000),
});

export async function GET() {
  try {
    const session = await requireSession();
    await assertZohoImport(session, "contacts");
    return NextResponse.json(await withTenant(session.tenantId, (tx) => previewSchemeMapping(tx, session.tenantId)));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertZohoImport(session, "contacts");
    requireCap(session.roles, "investor.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const actor = { tenantId: session.tenantId, userId: session.userId, branchId: session.branchId ?? null, roles: session.roles };
    const r = await withTenant(session.tenantId, (tx) => applySchemeMapping(tx, actor, parse.data.mappings), {
      userId: session.userId,
      branchId: session.branchId ?? undefined,
      roles: session.roles,
    });
    return NextResponse.json(r);
  } catch (err) {
    return handleApiError(err);
  }
}
