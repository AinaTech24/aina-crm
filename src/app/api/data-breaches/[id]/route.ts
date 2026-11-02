/**
 * PATCH /api/data-breaches/:id
 *   { action: "details", title?, description?, dataAffected?, cause?, consequences?,
 *     mitigation?, personSteps?, affectedCount?, occurredAt? }
 *   { action: "step", step: "board_intimated" | "board_report" | "people_notified" | "close", count? }
 * Needs `compliance.edit`.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { dataBreaches } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { markBreachStep, updateBreachDetails } from "@/lib/privacy/breaches";

export const dynamic = "force-dynamic";

const text = z.string().trim().max(4000).nullable().optional();

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("details"),
    title: z.string().trim().min(3).max(200).optional(),
    description: text,
    dataAffected: text,
    cause: text,
    consequences: text,
    mitigation: text,
    personSteps: text,
    affectedCount: z.number().int().min(0).nullable().optional(),
    occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
  }),
  z.object({
    action: z.literal("step"),
    step: z.enum(["board_intimated", "board_report", "people_notified", "close"]),
    count: z.number().int().min(0).nullable().optional(),
  }),
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details and try again." }, { status: 400 });
    }
    const body = parse.data;
    const actor = { tenantId: session.tenantId, userId: session.userId };
    const res = await withTenant(session.tenantId, async (tx) => {
      const [b] = await tx.select({ status: dataBreaches.status }).from(dataBreaches)
        .where(and(eq(dataBreaches.tenantId, session.tenantId), eq(dataBreaches.id, id)));
      if (!b) return "missing" as const;
      if (b.status !== "open") return "closed" as const;
      if (body.action === "step") {
        await markBreachStep(tx, actor, id, body.step, body.count ?? null);
      } else {
        const { action: _a, occurredAt, ...rest } = body;
        void _a;
        await updateBreachDetails(tx, actor, id, {
          ...rest,
          ...(occurredAt !== undefined ? { occurredAt: occurredAt ? new Date(occurredAt) : null } : {}),
        });
      }
      return "ok" as const;
    });
    if (res === "missing") return NextResponse.json({ error: "Breach not found" }, { status: 404 });
    if (res === "closed") return NextResponse.json({ error: "This breach is closed." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
