/**
 * PUT /api/me/pay/declaration — the caller's own tax declaration for the
 * current financial year (lib/payroll/tax.ts): the regime, the amounts they
 * declare and, from January, the proofs they submit. Saved declarations count
 * from the next payroll calculation. Self-service (session.userId only) —
 * listed in scripts/check-require-cap.mjs.
 *
 * A proof amount the employee changes goes back to "to verify"; payroll
 * verifies or rejects it (PATCH /api/payroll/declarations/:id).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { taxDeclarations } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { fyStart } from "@/lib/payroll/run";
import { DeclarationSchema, PROOF_ITEMS, readProofs, type ProofKey, type Proofs } from "@/lib/payroll/tax";

export const dynamic = "force-dynamic";

const KEYS = PROOF_ITEMS.map((p) => p.key) as [ProofKey, ...ProofKey[]];
const Body = z.object({
  regime: z.enum(["new", "old"]),
  declared: DeclarationSchema,
  submit: z.boolean().optional(),
  proofs: z.record(z.enum(KEYS), z.object({ amount: z.number().min(0).max(100_000_000), note: z.string().trim().max(300).optional() })).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details" }, { status: 400 });
    const b = parse.data;
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const fy = fyStart(today);
    await withTenant(session.tenantId, async (tx) => {
      const [cur] = await tx
        .select()
        .from(taxDeclarations)
        .where(and(eq(taxDeclarations.tenantId, session.tenantId), eq(taxDeclarations.userId, session.userId), eq(taxDeclarations.fyStart, fy)));
      const proofs: Proofs = readProofs(cur?.proofs);
      for (const [k, v] of Object.entries(b.proofs ?? {}) as Array<[ProofKey, { amount: number; note?: string }]>) {
        const was = proofs[k];
        if (was?.status === "verified" && was.amount === v.amount) continue;
        proofs[k] = { status: "submitted", amount: v.amount, note: v.note };
      }
      const values = {
        regime: b.regime,
        declared: b.declared as Record<string, unknown>,
        proofs: proofs as Record<string, unknown>,
        submittedAt: b.submit || cur?.submittedAt ? cur?.submittedAt ?? new Date() : null,
        updatedAt: new Date(),
      };
      if (cur) await tx.update(taxDeclarations).set(values).where(eq(taxDeclarations.id, cur.id));
      else await tx.insert(taxDeclarations).values({ tenantId: session.tenantId, userId: session.userId, fyStart: fy, ...values });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
