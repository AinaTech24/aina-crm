import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/export — the modules this person may export (their keys). The
 * Export button asks once per session and stays hidden on the rest.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { EXPORT_MODULES } from "@/lib/export/registry";
import { canExportModule } from "@/lib/export/run";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const modules = Object.values(EXPORT_MODULES).filter((m) => canExportModule(session, m)).map((m) => m.key);
    return NextResponse.json({ modules });
  } catch (err) {
    return handleApiError(err);
  }
}
