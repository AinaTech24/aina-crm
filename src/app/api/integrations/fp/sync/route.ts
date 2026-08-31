import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { enqueueFpSync, resolveFpConfigForTenant } from "@/lib/fp/sync";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { withTenant } from "@/db/client";

/**
 * POST /api/integrations/fp/sync
 *
 * On-demand FintechPrimitives API-pull sync. Enqueues a job that pulls folios +
 * transactions (with capital-gains) from FP and upserts them — the same path
 * the daily scheduled sync uses. Returns { importId } so the UI can poll
 * /api/rta-imports/:id (the row shows on the RTA Imports dashboard).
 *
 * This is the PRIMARY import path. The manual file upload remains only as a
 * self-serve backfill for tenants not on FP's RTA auto-forward route.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await requireSession();
  requireCap(session.roles, "transactions.execute", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);

  // Fail fast if THIS firm hasn't configured FP (their own creds, or env fallback).
  const cfg = await resolveFpConfigForTenant(session.tenantId);
  if (!cfg) {
    return NextResponse.json(
      { error: "Mailback Import is not configured. Add your credentials in Settings → Integrations." },
      { status: 400 }
    );
  }

  const importId = await enqueueFpSync(
    session.tenantId,
    { userId: session.userId, branchId: session.branchId, roles: session.roles },
    "manual"
  );

  await withTenant(
    session.tenantId,
    async (tx) => {
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "rta_import.fp_sync",
        entityType: "rta_file_import",
        entityId: importId,
        after: { source: "fintech_primitives", trigger: "manual", status: "queued" },
        ...clientMetaFromHeaders(req.headers),
      });
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return NextResponse.json({ importId, status: "queued" });
}
