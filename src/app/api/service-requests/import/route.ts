/**
 * POST /api/service-requests/import?mode=check|import — the Excel import (lib/imports/sheet).
 * check reads and checks the file and saves nothing; import saves the rows that passed.
 */
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { importResponse } from "@/lib/imports/sheet/http";
import { serviceRequestsImport } from "@/lib/imports/sheet/service-requests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "service_request.manage", session.permissions);
    return await importResponse(req, session, serviceRequestsImport);
  } catch (err) {
    return handleApiError(err);
  }
}
