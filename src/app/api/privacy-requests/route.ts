/**
 * POST /api/privacy-requests — log a DPDP rights request (lib/privacy/requests.ts).
 * Body: { subject?: { type: "investor" | "lead", id }, requesterName, requesterEmail?,
 *         requesterPhone?, type, channel, details?, receivedOn: "yyyy-mm-dd", assigneeId? }
 * Needs `compliance.edit` (compliance officer; the owner implicitly).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { createPrivacyRequest } from "@/lib/privacy/requests";
import { REQUEST_CHANNELS, REQUEST_TYPES, type RequestChannel, type RequestType } from "@/lib/privacy/requests-core";

export const dynamic = "force-dynamic";

const Body = z.object({
  subject: z.object({ type: z.enum(["investor", "lead"]), id: z.string().uuid() }).nullable().optional(),
  requesterName: z.string().trim().min(1, "Enter who made the request").max(200),
  requesterEmail: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  requesterPhone: z.string().trim().max(30).optional(),
  type: z.enum(Object.keys(REQUEST_TYPES) as [RequestType, ...RequestType[]]),
  channel: z.enum(Object.keys(REQUEST_CHANNELS) as [RequestChannel, ...RequestChannel[]]),
  details: z.string().trim().max(4000).optional(),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was received"),
  assigneeId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details and try again." }, { status: 400 });
    }
    const b = parse.data;
    // Received today starts the clock now; an earlier day starts it at 10:00 India time.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    if (b.receivedOn > today) return NextResponse.json({ error: "The date received cannot be in the future." }, { status: 400 });
    const receivedAt = b.receivedOn === today ? new Date() : new Date(`${b.receivedOn}T10:00:00+05:30`);
    const out = await withTenant(session.tenantId, (tx) =>
      createPrivacyRequest(tx, { tenantId: session.tenantId, userId: session.userId }, {
        subject: b.subject ?? null,
        requesterName: b.requesterName,
        requesterEmail: b.requesterEmail || null,
        requesterPhone: b.requesterPhone || null,
        type: b.type,
        channel: b.channel,
        details: b.details || null,
        receivedAt,
        assigneeId: b.assigneeId ?? null,
      })
    );
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return handleApiError(err);
  }
}
