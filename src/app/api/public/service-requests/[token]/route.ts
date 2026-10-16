/**
 * POST /api/public/service-requests/[token] — the firm's public service request form.
 *
 * No session: the caller is the public internet, and the token in the link
 * identifies the firm (lib/service-requests/web-form.ts). Each service chosen
 * opens a service request in that firm's scope (withTenant), so RLS applies as
 * for any ticket; the system read is only the token → firm lookup.
 *
 * Abuse controls, as on the complaint form:
 *   - a per-IP brake (20/hour) — wide, because mobile networks put many people
 *     behind one address;
 *   - a per-link brake (120/hour) — one link serves a whole firm's clients;
 *   - a honeypot field, answered with a fake success so a bot learns nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { enforce, enforceLinkToken } from "@/lib/rate-limit";
import { parseServiceSubmission } from "@/lib/service-requests/web-submission";
import { resolveServiceForm, submitWebServiceRequest } from "@/lib/service-requests/web-form";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ipLimited = enforce(req, "service-form.submit", { limit: 20, windowSec: 60 * 60 });
  if (ipLimited) return ipLimited;
  const linkLimited = enforceLinkToken("service-form.submit", token, 120);
  if (linkLimited) return linkLimited;

  const parsed = parseServiceSubmission(await req.json().catch(() => null));
  if (parsed.kind === "trap") return NextResponse.json({ ok: true, requests: [] });
  if (parsed.kind === "invalid") return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const form = await resolveServiceForm(token);
    if (!form) {
      return NextResponse.json({ error: "This link is not valid. Please contact the firm directly." }, { status: 404 });
    }
    if (!form.enabled) {
      return NextResponse.json(
        { error: `${form.firmName} is not taking service requests through this form at the moment. Please contact them directly.` },
        { status: 410 },
      );
    }
    const opened = await withTenant(form.tenantId, (tx) => submitWebServiceRequest(tx, form.tenantId, parsed.value));
    return NextResponse.json(
      {
        ok: true,
        requests: opened.map((o) => ({ serviceId: o.ticketNo, service: o.label, respondBy: o.respondBy.toISOString(), alreadyOpen: o.alreadyOpen })),
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
