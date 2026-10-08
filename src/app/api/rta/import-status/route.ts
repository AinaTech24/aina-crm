import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/rta/import-status?jobId=…
 *
 * Polled by the rich importer after enqueuing. Returns the BullMQ job state and,
 * once complete, the import summary (the worker's return value). Tenant-scoped:
 * a job's result is only returned to the tenant that created it.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { maskImportText, requireRtaImportAccess, RTA_IMPORT_CAPABILITY } from "@/lib/rta/import-access";
import { Q } from "@/workers/queues";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Same access as the import that created the job (lib/rta/import-access).
    requireCap(session.roles, RTA_IMPORT_CAPABILITY, session.permissions);
    await requireRtaImportAccess(session);

    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

    const job = await Q.rtaImport().getJob(jobId);
    if (!job) return NextResponse.json({ state: "unknown" });
    // Don't leak another tenant's import across a guessed job id: a job of
    // another firm answers exactly like a job that does not exist.
    if (!job.data || (job.data as any).tenantId !== session.tenantId) {
      return NextResponse.json({ state: "unknown" });
    }

    const state = await job.getState();
    if (state === "completed") {
      return NextResponse.json({ state, result: job.returnvalue ?? null });
    }
    if (state === "failed") {
      // A failure reason can quote a row (and its PAN) — mask before it leaves.
      return NextResponse.json({ state, error: maskImportText(job.failedReason ?? "import failed") });
    }
    // waiting | active | delayed | … — include live progress (phase + pct + counts)
    // so the UI can render a bar + ETA instead of an indeterminate spinner.
    return NextResponse.json({ state, progress: job.progress ?? null });
  } catch (err: any) {
    return handleApiError(err);
  }
}
