import { handleApiError } from "@/lib/api/error-handler";
/**
 * The starter operations manual (lib/practice/starter-manual.ts).
 *
 *   GET  → { total, installed, deleted, missing } — how much of it the firm has.
 *   POST → installs what is missing (idempotent): { installed, skipped, linksAdded }.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { installStarterManual, starterManualStatus } from "@/lib/practice/install-starter-manual";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const status = await withTenant(session.tenantId, (tx) => starterManualStatus(tx, session.tenantId), {
      userId: session.userId,
      branchId: session.branchId ?? undefined,
      roles: session.roles,
    });
    return NextResponse.json(status);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "sop.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const meta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const r = await installStarterManual(tx, session.tenantId, session.userId);
        if (r.installed > 0 || r.linksAdded > 0) {
          await recordAudit(tx, {
            tenantId: session.tenantId,
            actorUserId: session.userId,
            action: "sop.starter_install",
            entityType: "sop",
            after: { ...r },
            ...meta,
          });
        }
        return r;
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles },
    );
    return NextResponse.json(result, { status: result.installed > 0 ? 201 : 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
