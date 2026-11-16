import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/imports/zoho/contacts — multipart: file, dryRun ("1" = preview,
 * nothing saved), unmatchedToMe ("1" = clients of an owner with no user go to
 * the person importing). Only for a firm with the "Zoho CRM import" flag
 * (lib/imports/zoho/access.ts). See lib/imports/zoho/run-contacts.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertZohoImport, zohoImportEnabled } from "@/lib/imports/zoho/access";
import { readZohoFile } from "@/lib/imports/zoho/workbook";
import { importZohoContacts } from "@/lib/imports/zoho/run-contacts";

export const dynamic = "force-dynamic";

/** GET — is the Zoho import on for this firm? (The Clients import page shows its link only then.) */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ enabled: await zohoImportEnabled(session.tenantId, session.roles) });
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
    const form = await req.formData();
    const { headers, rows } = await readZohoFile(form.get("file"), "contacts");
    const result = await importZohoContacts(
      { tenantId: session.tenantId, userId: session.userId, branchId: session.branchId ?? null, roles: session.roles },
      headers,
      rows,
      { dryRun: form.get("dryRun") === "1", unmatchedOwnersToMe: form.get("unmatchedToMe") === "1" }
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
