/**
 * POST /api/me/pay/claims — claim an expense (lib/payroll/claims.ts).
 * Self-service: the claim is always the caller's own (session.userId), so no
 * capability applies — listed in scripts/check-require-cap.mjs.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { reimbursementClaims } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, isUniqueViolation } from "@/lib/api/error-handler";
import { CLAIM_CATEGORIES, claimDedupKey } from "@/lib/payroll/claims";

export const dynamic = "force-dynamic";

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const Body = z.object({
  category: z.enum(CLAIM_CATEGORIES.map((c) => c.key) as [string, ...string[]]),
  claimDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date on the bill"),
  amount: z.number().positive("Enter the amount").max(1_000_000),
  billNumber: z.string().trim().max(60).optional(),
  description: z.string().trim().min(3, "Say what it was for").max(300),
});

const DUPLICATE = "This bill has already been claimed.";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Check the details" }, { status: 400 });
    const b = parse.data;
    if (b.claimDate > today()) return NextResponse.json({ error: "The bill date cannot be in the future." }, { status: 400 });
    const dedupKey = claimDedupKey(session.userId, b.category, b.claimDate, b.amount, b.billNumber);
    const id = await withTenant(session.tenantId, async (tx) => {
      const [dup] = await tx
        .select({ id: reimbursementClaims.id })
        .from(reimbursementClaims)
        .where(and(eq(reimbursementClaims.tenantId, session.tenantId), eq(reimbursementClaims.dedupKey, dedupKey), notInArray(reimbursementClaims.status, ["rejected", "withdrawn"])));
      if (dup) throw Object.assign(new Error(DUPLICATE), { status: 409 });
      const [row] = await tx
        .insert(reimbursementClaims)
        .values({
          tenantId: session.tenantId,
          userId: session.userId,
          category: b.category,
          claimDate: b.claimDate,
          amount: String(b.amount),
          billNumber: b.billNumber || null,
          description: b.description,
          dedupKey,
        })
        .returning({ id: reimbursementClaims.id });
      return row.id;
    });
    return NextResponse.json({ id });
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: DUPLICATE }, { status: 409 });
    return handleApiError(err);
  }
}
