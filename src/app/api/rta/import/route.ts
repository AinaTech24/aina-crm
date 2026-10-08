/**
 * POST /api/rta/import — RETIRED (410 Gone).
 *
 * This was the legacy synchronous RTA importer: a multipart upload parsed and
 * upserted INSIDE the web request (maxDuration 300). That is exactly the
 * in-request heavy parse that blocked Node's event loop, 503-ed the site and
 * OOM-crashed the web process (see /api/rta-imports/upload), and a multipart
 * body through the middleware is also truncated at Next's ~10 MB default. No
 * screen calls it — the live importer is the RTA File Imports page
 * (/dashboard/rta-imports: presigned upload → background worker), and the old
 * RtaImporter component that used the async variant is not rendered anywhere.
 *
 * It now refuses every call with 410 and a pointer to the supported path, after
 * the usual session + capability checks (so an anonymous caller still gets 401
 * and learns nothing). The parse code it called (lib/rta, lib/rta/import) is
 * untouched and still used by the worker.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { RTA_IMPORT_CAPABILITY } from "@/lib/rta/import-access";

export const dynamic = "force-dynamic";

const RETIRED_MESSAGE =
  "This import endpoint has been retired: it parsed files inside the web request, which is unsafe for large RTA files. " +
  "Upload the file on the RTA File Imports page (/dashboard/rta-imports) instead — it is processed in the background.";

export async function POST() {
  try {
    const session = await requireSession();
    requireCap(session.roles, RTA_IMPORT_CAPABILITY, session.permissions);
    return NextResponse.json(
      { error: RETIRED_MESSAGE, use: "/dashboard/rta-imports" },
      { status: 410 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
