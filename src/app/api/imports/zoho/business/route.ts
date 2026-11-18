import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/imports/zoho/business — multipart: file (the Zoho MF Transaction
 * export: the parent sheet + "SIP and SIP Stop" + "Purchase and Redemption"
 * subform sheets, in one workbook), dryRun ("1" = preview, nothing saved),
 * unmatchedToMe ("1" = entries of an owner with no user go to the person
 * importing). Only for a firm with the "Zoho CRM import" flag. See
 * lib/imports/zoho/run-business.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertZohoImport } from "@/lib/imports/zoho/access";
import { readZohoWorkbook, ZohoFileError } from "@/lib/imports/zoho/workbook";
import { identifySheets } from "@/lib/imports/zoho/business";
import { importZohoBusiness } from "@/lib/imports/zoho/run-business";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertZohoImport(session, "contacts");
    requireCap(session.roles, "investor.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const form = await req.formData();
    const { sheets, headers } = await readZohoWorkbook(form.get("file"));
    const found = identifySheets(sheets, headers);
    if (!found.parent) {
      throw new ZohoFileError("This is not a Zoho MF Transaction export: no sheet has the MF Transaction Name and MF Transaction Owner columns.");
    }
    if (!found.names.sip && !found.names.purchase) {
      throw new ZohoFileError("The subform sheets are missing: add the 'SIP and SIP Stop' and 'Purchase and Redemption' sheets Zoho exports with the MF Transactions.");
    }
    const result = await importZohoBusiness(
      { tenantId: session.tenantId, userId: session.userId, branchId: session.branchId ?? null, roles: session.roles },
      { parent: found.parent, sip: found.sip, purchase: found.purchase },
      { dryRun: form.get("dryRun") === "1", unmatchedOwnersToMe: form.get("unmatchedToMe") === "1" }
    );
    return NextResponse.json({ ...result, sheets: found.names });
  } catch (err) {
    return handleApiError(err);
  }
}
