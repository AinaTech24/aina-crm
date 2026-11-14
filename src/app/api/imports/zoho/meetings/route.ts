import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/imports/zoho/meetings — multipart: file, dryRun ("1" = preview,
 * nothing saved), unmatchedToMe ("1" = meetings of a host with no user go to
 * the person importing). Only for a firm with the "Zoho CRM import" flag
 * (lib/imports/zoho/access.ts). See lib/imports/zoho/run-meetings.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertZohoImport } from "@/lib/imports/zoho/access";
import { readZohoFile } from "@/lib/imports/zoho/workbook";
import { importZohoMeetings } from "@/lib/imports/zoho/run-meetings";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertZohoImport(session, "meetings");
    requireCap(session.roles, "review_meeting.manage.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const form = await req.formData();
    const { rows } = await readZohoFile(form.get("file"), "meetings");
    const result = await importZohoMeetings(
      { tenantId: session.tenantId, userId: session.userId, branchId: session.branchId ?? null, roles: session.roles },
      rows,
      { dryRun: form.get("dryRun") === "1", unmatchedHostsToMe: form.get("unmatchedToMe") === "1" }
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
