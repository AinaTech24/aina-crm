import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/imports/zoho/families — multipart: file (a Zoho family sheet:
 * Record Id, Contact Name, Family Owner.id, Family Owner), dryRun ("1" =
 * preview, nothing saved). Builds families for clients already in the CRM.
 * Only for a firm with the "Zoho CRM import" flag. See
 * lib/imports/zoho/run-families.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertZohoImport } from "@/lib/imports/zoho/access";
import { readZohoFile } from "@/lib/imports/zoho/workbook";
import { importZohoFamilies } from "@/lib/imports/zoho/run-families";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertZohoImport(session, "contacts");
    requireCap(session.roles, "investor.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const form = await req.formData();
    const { rows } = await readZohoFile(form.get("file"), "families");
    const result = await importZohoFamilies(
      { tenantId: session.tenantId, userId: session.userId, branchId: session.branchId ?? null, roles: session.roles },
      rows,
      { dryRun: form.get("dryRun") === "1" }
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
