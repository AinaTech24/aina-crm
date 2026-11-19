/**
 * PATCH /api/payroll/declarations/:id { proofs: { item: { status, amount?, note? } } }
 * — payroll verifies or rejects a person's tax proofs (lib/payroll/tax.ts).
 * After the proof deadline only verified amounts reduce TDS. Needs
 * `payroll.manage`; audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { taxDeclarations } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { recordAudit } from "@/lib/audit";
import { PROOF_ITEMS, readProofs, type ProofKey } from "@/lib/payroll/tax";

export const dynamic = "force-dynamic";

const KEYS = PROOF_ITEMS.map((p) => p.key) as [ProofKey, ...ProofKey[]];
const Body = z.object({
  proofs: z.record(
    z.enum(KEYS),
    z.object({ status: z.enum(["verified", "rejected"]), amount: z.number().min(0).max(100_000_000).optional(), note: z.string().trim().max(300).optional() })
  ),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const { id } = await params;
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Check the details" }, { status: 400 });
    await withTenant(session.tenantId, async (tx) => {
      const [d] = await tx.select().from(taxDeclarations).where(and(eq(taxDeclarations.tenantId, session.tenantId), eq(taxDeclarations.id, id)));
      if (!d) throw Object.assign(new Error("Declaration not found"), { status: 404 });
      if (d.userId === session.userId) throw Object.assign(new Error("Someone else must verify your own proofs."), { status: 403 });
      const proofs = readProofs(d.proofs);
      for (const [k, v] of Object.entries(parse.data.proofs) as Array<[ProofKey, { status: "verified" | "rejected"; amount?: number; note?: string }]>) {
        const was = proofs[k];
        proofs[k] = { status: v.status, amount: v.status === "verified" ? v.amount ?? was?.amount ?? 0 : 0, note: v.note ?? was?.note };
      }
      await tx.update(taxDeclarations).set({ proofs: proofs as Record<string, unknown>, updatedAt: new Date() }).where(eq(taxDeclarations.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "payroll.proofs_reviewed",
        entityType: "tax_declaration", entityId: id, after: { userId: d.userId, items: Object.keys(parse.data.proofs) },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
