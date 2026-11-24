/**
 * POST /api/review-meetings/import?mode=check|import — the Excel import (lib/imports/sheet).
 * check reads and checks the file and saves nothing; import saves the rows that passed.
 */
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { importResponse } from "@/lib/imports/sheet/http";
import { meetingsImport } from "@/lib/imports/sheet/meetings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all"], session.permissions);
    return await importResponse(req, session, meetingsImport);
  } catch (err) {
    return handleApiError(err);
  }
}
