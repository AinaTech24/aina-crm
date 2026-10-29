/**
 * Tickets an email once opened (before 2026-10-16, when that stopped).
 *
 *   GET   → { count }  how many are open and untouched by a person
 *   POST  → { closed } closes them all (service_request.manage)
 */

import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { closeEmailIntakeTickets, countEmailIntakeTickets } from "@/lib/service-requests/email-intake";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "service_request.manage", session.permissions);
    const count = await withTenant(session.tenantId, (tx) => countEmailIntakeTickets(tx, session.tenantId));
    return NextResponse.json({ count });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "service_request.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const closed = await withTenant(session.tenantId, (tx) =>
      closeEmailIntakeTickets(tx, { tenantId: session.tenantId, actorUserId: session.userId, actorName: session.name ?? null })
    );
    return NextResponse.json({ ok: true, closed });
  } catch (err) {
    return handleApiError(err);
  }
}
