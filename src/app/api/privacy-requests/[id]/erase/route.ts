/**
 * POST /api/privacy-requests/:id/erase — carry out an erasure request
 * (lib/privacy/requests.ts eraseSubject). Only an open erasure request, linked
 * to a client or lead, whose requester's identity was verified. A client who
 * holds money or is still a client is refused with the reason; a former client
 * inside the retention period is kept, and marketing to them stops.
 * Needs `compliance.edit`.
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { privacyRequests } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { eraseSubject } from "@/lib/privacy/requests";

export const dynamic = "force-dynamic";

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const out = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx.select().from(privacyRequests)
        .where(and(eq(privacyRequests.tenantId, session.tenantId), eq(privacyRequests.id, id)));
      if (!r) throw fail("Request not found", 404);
      if (r.status !== "open") throw fail("This request is already closed.", 409);
      if (r.type !== "erasure") throw fail("Only an erasure request can erase data.", 400);
      if (!r.identityVerifiedAt) throw fail("Verify the requester's identity first.", 400);
      if (!r.subjectType || !r.subjectId) throw fail("This request is not linked to a client or lead.", 400);
      if (r.erasureResult === "erased") throw fail("Already erased.", 409);
      return eraseSubject(tx, { tenantId: session.tenantId, userId: session.userId }, id, {
        type: r.subjectType as "investor" | "lead",
        id: r.subjectId,
      });
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return handleApiError(err);
  }
}
