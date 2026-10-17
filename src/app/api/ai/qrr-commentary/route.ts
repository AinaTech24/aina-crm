import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/qrr-commentary
 * Body: { investorId, marketContext? }
 *
 * Used by the Quarterly Review Report (QRR) generator + investor detail
 * page. Reads the investor + last 10 transactions + last review notes,
 * returns a 250-400 word commentary paragraph. RM edits + accepts; the
 * commentary is then embedded in the QRR PDF.
 *
 * Read-only — never writes back. The QRR PDF route is the only thing
 * that persists the accepted text (in qrr_runs.commentary).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { transactions, reviewMeetings } from "@/db/schema";
import { loadViewableInvestor } from "@/lib/investors/access";
import { withOwnRiskForMinor } from "@/lib/risk-profile/own-assessment";
import { generateQrrCommentary } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  marketContext: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }

    const ctx = await withTenant(session.tenantId, async (tx) => {
      // Only a client the caller may open (404 outside their book, same as the
      // client page) — the commentary is built from that client's record.
      const viewable = await loadViewableInvestor(tx, session, parse.data.investorId);
      if (!viewable) return null;
      // A minor's risk is their own assessment, never the guardian's copy (G-1).
      const inv = await withOwnRiskForMinor(tx, session.tenantId, viewable);
      const recent = await tx
        .select({
          orderDate: transactions.orderDate,
          type: transactions.type,
          schemeCategory: transactions.schemeCategory,
          amount: transactions.amount,
        })
        .from(transactions)
        .where(eq(transactions.investorId, parse.data.investorId))
        .orderBy(desc(transactions.orderDate))
        .limit(10);
      const lastReview = (
        await tx
          .select({ notes: reviewMeetings.meetingNotes })
          .from(reviewMeetings)
          .where(
            and(
              eq(reviewMeetings.investorId, parse.data.investorId),
              eq(reviewMeetings.status, "completed")
            )
          )
          .orderBy(desc(reviewMeetings.meetingDate))
          .limit(1)
      )[0];
      return { inv, recent, lastReviewNotes: lastReview?.notes ?? null };
    });

    if (!ctx) {
      return NextResponse.json({ error: "investor not found" }, { status: 404 });
    }

    const result = await generateQrrCommentary({
      investorName: ctx.inv.name ?? "Investor",
      riskProfile: ctx.inv.riskProfile ?? null,
      totalAumInr: ctx.inv.aum != null ? Number(ctx.inv.aum) : null,
      totalSipInr:
        ctx.inv.activeSipAmount != null ? Number(ctx.inv.activeSipAmount) : null,
      recentTransactions: ctx.recent.map((r) => ({
        date: r.orderDate ? String(r.orderDate) : "",
        type: r.type ?? "—",
        schemeCategory: r.schemeCategory ?? undefined,
        amount: r.amount != null ? Number(r.amount) : undefined,
      })),
      lastReviewNotes: ctx.lastReviewNotes,
      marketContext: parse.data.marketContext,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
