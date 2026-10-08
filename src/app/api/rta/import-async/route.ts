import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/rta/import-async
 *
 * Enqueue a RICH master/holdings import (the file is already in S3 via
 * /api/rta/import-url). The heavy CAMS R9 / KFintech parse + investor/folio
 * upsert runs in the worker (concurrency 1, isolated) so a large file never
 * blocks or OOMs the web server. Returns { jobId }; the client polls
 * /api/rta/import-status?jobId=… for the result. Supports dryRun (preview).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { requireRtaImportAccess, RTA_IMPORT_CAPABILITY } from "@/lib/rta/import-access";
import { assertActiveLicense } from "@/lib/auth/license";
import { Q } from "@/workers/queues";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  key: z.string().min(1).max(500),
  filename: z.string().min(1).max(300),
  rta: z.string().max(40).optional().default(""),
  reportType: z.string().max(40).optional().default(""),
  password: z.string().max(200).optional(),
  dryRun: z.boolean().optional().default(false),
  assignToMe: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Same access as the live upload route (lib/rta/import-access): the RTA
    // import capability on a book not narrowed to the caller's own clients.
    // (Was investor.edit.all OR dashboard.view.owner — out of step with the
    // upload path that imports the very same master files.)
    requireCap(session.roles, RTA_IMPORT_CAPABILITY, session.permissions);
    await requireRtaImportAccess(session);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", details: parse.error.flatten() }, { status: 400 });
    const { key, filename, rta, reportType, password, dryRun, assignToMe } = parse.data;

    // SECURITY: the key must live under THIS tenant's prefix (built by
    // /api/rta/import-url) — never let a client point us at another tenant's object.
    if (!key.startsWith(`tenants/${session.tenantId}/rta/`)) {
      return NextResponse.json({ error: "invalid key for tenant" }, { status: 403 });
    }

    const job = await Q.rtaImport().add(
      "rich-import",
      {
        mode: "rich",
        tenantId: session.tenantId,
        key,
        filename,
        password: password || undefined,
        rta,
        reportType,
        dryRun,
        assignToMe,
        userId: session.userId,
        branchId: session.branchId,
        roles: session.roles,
      },
      {
        attempts: 1,
        // Keep the completed/failed job briefly so the status poll can read the
        // return value / failure reason; the password (in job data) is dropped
        // with it.
        removeOnComplete: { age: 900 },
        removeOnFail: { age: 900 },
      }
    );

    return NextResponse.json({ jobId: String(job.id) });
  } catch (err: any) {
    return handleApiError(err);
  }
}
