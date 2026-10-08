/**
 * POST /api/public/feedback/web/[token] — the firm's public feedback form.
 *
 * No session: the token in the link identifies the firm
 * (lib/feedback/web-form.ts). The response is filed in that firm's scope
 * (withTenant); the system read is only the token → firm lookup.
 *
 * Abuse controls, as on the complaint form: a per-IP brake (20/hour, wide
 * because mobile networks share addresses), a per-link brake (120/hour — one
 * link serves a whole firm), and a honeypot answered with a fake success.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { enforce, enforceLinkToken } from "@/lib/rate-limit";
import { parseWebFeedback, resolveFeedbackForm, submitWebFeedback } from "@/lib/feedback/web-form";
import { feedbackReceipt } from "@/lib/feedback/receipt";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ipLimited = enforce(req, "feedback-form.submit", { limit: 20, windowSec: 60 * 60 });
  if (ipLimited) return ipLimited;
  const linkLimited = enforceLinkToken("feedback-form.submit", token, 120);
  if (linkLimited) return linkLimited;

  const parsed = parseWebFeedback(await req.json().catch(() => null));
  if (parsed.kind === "trap") return NextResponse.json({ ok: true });
  if (parsed.kind === "invalid") return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const form = await resolveFeedbackForm(token);
    if (!form) return NextResponse.json({ error: "This feedback link is not valid." }, { status: 404 });
    if (!form.enabled) {
      return NextResponse.json({ error: `${form.firmName} is not taking feedback through this link at the moment.` }, { status: 410 });
    }
    const r = await withTenant(form.tenantId, (tx) => submitWebFeedback(tx, form.tenantId, parsed.value));
    // Lets the person fetch THEIR response as a PDF (/api/public/feedback/pdf).
    return NextResponse.json({ ok: true, rating: r.rating, receipt: feedbackReceipt(form.tenantId, r.id) }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
