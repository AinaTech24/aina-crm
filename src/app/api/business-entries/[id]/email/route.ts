import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/business-entries/[id]/email — email the client a transactional
 * confirmation summarising the booked business. Uses the firm's own email
 * sender (SMTP / Resend) via the email adapter; marks the entry 'emailed'.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { businessEntries, businessEntryLines, investors } from "@/db/schema";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { renderBusinessEmail } from "@/lib/business/email";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const meta = clientMetaFromHeaders(req.headers);

    const ctx = await withTenant(session.tenantId, async (tx) => {
      const [entry] = await tx
        .select()
        .from(businessEntries)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!entry) return { error: "not_found" as const };
      const lines = await tx
        .select()
        .from(businessEntryLines)
        .where(eq(businessEntryLines.entryId, id))
        .orderBy(asc(businessEntryLines.sortOrder));

      let email: string | null = null;
      if (entry.investorId) {
        const [inv] = await tx.select({ email: investors.email }).from(investors).where(eq(investors.id, entry.investorId)).limit(1);
        email = inv?.email ?? null;
      }
      const firm = (await tx.execute(sql`SELECT name FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1`)).rows[0] as any;
      return { entry, lines, email, firmName: firm?.name ?? "Your advisor" };
    });

    if ("error" in ctx) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!ctx.email) {
      return NextResponse.json({ error: "This client has no email on file. Link a client with an email to send." }, { status: 400 });
    }

    const { subject, text, html } = renderBusinessEmail({
      clientName: ctx.entry.clientName,
      firmName: ctx.firmName,
      productType: ctx.entry.productType,
      businessDate: String(ctx.entry.businessDate),
      total: ctx.entry.totalAmount,
      lines: ctx.lines.map((l) => ({ schemeName: l.schemeName, txnType: l.txnType, amount: l.amount, frequency: l.frequency, fromSchemeName: l.fromSchemeName })),
    });

    let externalId = "";
    try {
      const res = await emailAdapter.send({
        tenantId: session.tenantId,
        tokens: {},
        rendered: { subject, text, tokens: {} },
        recipient: ctx.email,
        category: "transactional",
        inlineHtml: html,
        idempotencyKey: `business-entry:${id}`,
      });
      externalId = res.externalId;
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message?.includes("RESEND_API_KEY") ? "Email is not configured yet (no sender). Set it up in Settings → Email." : (e?.message ?? "Could not send email") },
        { status: 502 }
      );
    }

    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(businessEntries)
        .set({ status: "emailed", emailedAt: new Date(), updatedAt: new Date() } as any)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "business_entry.email",
        entityType: "business_entry",
        entityId: id,
        after: { to: ctx.email, externalId } as any,
        ...meta,
      });
    });

    return NextResponse.json({ ok: true, externalId });
  } catch (err: any) {
    return handleApiError(err);
  }
}
