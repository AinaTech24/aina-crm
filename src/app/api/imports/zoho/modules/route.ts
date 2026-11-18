import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/imports/zoho/modules — multipart: file (a JSON file
 * { module, records } of records read through Zoho's API), dryRun ("1" =
 * preview, nothing saved), unmatchedToMe ("1" = records of a Zoho user with no
 * CRM user go to the person importing). Only for a firm with the "Zoho CRM
 * import" flag. See lib/imports/zoho/run-modules.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertZohoImport } from "@/lib/imports/zoho/access";
import { ZOHO_MODULES, type ZohoModule } from "@/lib/imports/zoho/modules";
import { importZohoModule } from "@/lib/imports/zoho/run-modules";

export const dynamic = "force-dynamic";

const MAX_BYTES = 40 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertZohoImport(session, "contacts");
    requireCap(session.roles, "investor.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Choose the Zoho data file (.json)." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is over 40 MB — split it." }, { status: 400 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return NextResponse.json({ error: "That is not a Zoho data file (.json)." }, { status: 400 });
    }
    const body = parsed as { module?: string; records?: unknown };
    const module = body?.module as ZohoModule;
    if (!ZOHO_MODULES.includes(module) || !Array.isArray(body.records)) {
      return NextResponse.json({ error: `The file must hold { module, records } for one of: ${ZOHO_MODULES.join(", ")}.` }, { status: 400 });
    }
    const result = await importZohoModule(
      { tenantId: session.tenantId, userId: session.userId, branchId: session.branchId ?? null, roles: session.roles },
      module,
      body.records as Record<string, unknown>[],
      { dryRun: form.get("dryRun") === "1", unmatchedToMe: form.get("unmatchedToMe") === "1" }
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
