import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/retention-action
 * Body: { name, score, band, factors[], serviceTier?, currentValueInr? }
 *
 * Given a client's churn-risk score + the explainable factors, returns a
 * concrete, SEBI-compliant retention play (summary, talking points, actions,
 * suggested channel). Advisory — the deterministic score remains the source of
 * truth. Used by the "Suggest a retention play" button on the investor 360 page.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { suggestRetention } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(200),
  score: z.number().int().min(0).max(100),
  band: z.enum(["low", "medium", "high"]),
  factors: z
    .array(z.object({ label: z.string().max(120), why: z.string().max(300) }))
    .max(12),
  serviceTier: z.string().max(4).nullable().optional(),
  currentValueInr: z.number().nonnegative().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const result = await suggestRetention(parse.data);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
