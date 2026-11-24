/**
 * POST /api/tasks/import?mode=check|import — the Excel import (lib/imports/sheet).
 * check reads and checks the file and saves nothing; import saves the rows that passed.
 */
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { importResponse } from "@/lib/imports/sheet/http";
import { tasksImport } from "@/lib/imports/sheet/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "task.edit.all", session.permissions);
    return await importResponse(req, session, tasksImport);
  } catch (err) {
    return handleApiError(err);
  }
}
