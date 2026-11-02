/**
 * POST /api/data-breaches — log a personal-data breach (lib/privacy/breaches.ts).
 * Body: { title, detectedAt (ISO), occurredAt?, description?, affectedCount? }
 * Starts the 72-hour clock for the Data Protection Board's report. Needs `compliance.edit`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { createBreach } from "@/lib/privacy/breaches";

export const dynamic = "force-dynamic";

const Body = z.object({
  title: z.string().trim().min(3, "Give the breach a short title").max(200),
  detectedAt: z.string().datetime({ offset: true, message: "When did the firm become aware of it?" }),
  occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
  description: z.string().trim().max(4000).optional(),
  affectedCount: z.number().int().min(0).nullable().optional(),
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
    const detectedAt = new Date(b.detectedAt);
    if (detectedAt.getTime() > Date.now() + 60_000) {
      return NextResponse.json({ error: "The time the firm became aware cannot be in the future." }, { status: 400 });
    }
    const out = await withTenant(session.tenantId, (tx) =>
      createBreach(tx, { tenantId: session.tenantId, userId: session.userId }, {
        title: b.title,
        detectedAt,
        occurredAt: b.occurredAt ? new Date(b.occurredAt) : null,
        description: b.description || null,
        affectedCount: b.affectedCount ?? null,
      })
    );
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return handleApiError(err);
  }
}
