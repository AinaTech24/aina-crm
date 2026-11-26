/**
 * POST /api/visitors/import?mode=check|import — the Excel / CSV import (lib/imports/sheet).
 * check reads and checks the file and saves nothing; import saves the rows that passed.
 * 404 for a firm without the Visitor Register.
 */
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { importResponse } from "@/lib/imports/sheet/http";
import { visitorsImport } from "@/lib/imports/sheet/visitors";
import { assertVisitorRegister, VISITOR_WRITE_CAPS } from "@/lib/visitors/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    await assertVisitorRegister(session);
    requireAny(session.roles, VISITOR_WRITE_CAPS, session.permissions);
    return await importResponse(req, session, visitorsImport);
  } catch (err) {
    return handleApiError(err);
  }
}
