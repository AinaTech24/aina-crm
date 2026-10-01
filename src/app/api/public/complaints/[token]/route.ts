/**
 * POST /api/public/complaints/[token] — the firm's public complaint form.
 *
 * No session: the caller is the public internet, and the token in the link
 * identifies the firm (lib/complaints/web-form.ts). The complaint opens a
 * service request in that firm's scope (withTenant), so RLS applies as for any
 * ticket; the system read is only the token → firm lookup.
 *
 * Abuse controls:
 *   - a per-IP brake (20/hour) — wide, because mobile networks put many people
 *     behind one address (the lesson of 88c7b697);
 *   - a per-link brake (60/hour) — one link serves a whole firm, which gets a
 *     handful of complaints a month, so this only stops a flood;
 *   - a honeypot field, answered with a fake success so a bot learns nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { enforce, enforceLinkToken } from "@/lib/rate-limit";
import { parseComplaintSubmission } from "@/lib/complaints/submission";
import { resolveComplaintForm, submitWebComplaint } from "@/lib/complaints/web-form";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ipLimited = enforce(req, "complaint-form.submit", { limit: 20, windowSec: 60 * 60 });
  if (ipLimited) return ipLimited;
  const linkLimited = enforceLinkToken("complaint-form.submit", token, 60);
  if (linkLimited) return linkLimited;

  const parsed = parseComplaintSubmission(await req.json().catch(() => null));
  if (parsed.kind === "trap") return NextResponse.json({ ok: true, ticketNo: null, respondBy: null });
  if (parsed.kind === "invalid") return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const form = await resolveComplaintForm(token);
    if (!form) {
      return NextResponse.json({ error: "This complaint form link is not valid. Please contact the firm directly." }, { status: 404 });
    }
    if (!form.enabled) {
      return NextResponse.json(
        { error: `${form.firmName} is not taking complaints through this form at the moment. Please contact them directly.` },
        { status: 410 },
      );
    }
    const r = await withTenant(form.tenantId, (tx) => submitWebComplaint(tx, form.tenantId, parsed.value));
    return NextResponse.json({ ok: true, ticketNo: r.ticketNo, respondBy: r.respondBy.toISOString() }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
