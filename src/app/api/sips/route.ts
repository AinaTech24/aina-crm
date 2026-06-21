import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/sips — manually register a SIP.
 *
 * SIPs normally flow in from the CAMS/KFintech feeds or an Excel import, but
 * MFDs also need to capture a SIP by hand (e.g. a fresh registration not yet in
 * the feed). Gated like other transaction writes (transactions.execute).
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sips, investors, users, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  schemeName: z.string().max(200).optional(),
  schemeCode: z.string().max(60).optional(),
  amcName: z.string().max(160).optional(),
  folioNumber: z.string().max(60).optional(),
  amount: z.number().positive().max(1e9),
  frequency: z.enum(["monthly", "quarterly", "weekly", "fortnightly", "yearly"]).default("monthly"),
  sipDate: z.string().regex(/^([1-9]|[12]\d|2[0-8])$/).optional(), // day of month 1..28
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(["active", "paused", "stopped", "rejected", "completed", "pending"]).default("active"),
  rmId: z.string().uuid().optional(),
  remarks: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      // Confirm the investor belongs to this tenant (RLS already scopes, but we
      // also want a clean 404 rather than an FK error) and fall back to their RM.
      const inv = (
        await tx
          .select({ id: investors.id, rmId: investors.rmId })
          .from(investors)
          .where(and(eq(investors.id, b.investorId), eq(investors.tenantId, session.tenantId)))
          .limit(1)
      )[0];
      if (!inv) {
        throw Object.assign(new Error("investor not found"), { status: 404 });
      }

      // An explicit RM must be a user in THIS firm (a stray uuid would attribute
      // the SIP to someone outside the tenant).
      if (b.rmId) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, b.rmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) throw Object.assign(new Error("RM not found in this firm"), { status: 400 });
      }

      const inserted = await tx
        .insert(sips)
        .values({
          id,
          tenantId: session.tenantId,
          investorId: b.investorId,
          schemeName: b.schemeName || null,
          schemeCode: b.schemeCode || null,
          amcName: b.amcName || null,
          folioNumber: b.folioNumber || null,
          amount: String(b.amount),
          frequency: b.frequency,
          sipDate: b.sipDate || null,
          startDate: b.startDate || null,
          endDate: b.endDate || null,
          nextInstallmentAt: b.startDate || null,
          status: b.status,
          rmId: b.rmId ?? inv.rmId ?? session.userId,
          remarks: b.remarks || null,
        } as any)
        .returning();

      // Let subscribed workflows react to a newly-registered SIP.
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "sip.created",
        entityType: "sip",
        entityId: id,
        after: inserted[0] as any,
        meta: { userId: session.userId, source: "manual" } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sip.create",
        entityType: "sip",
        entityId: id,
        after: { investorId: b.investorId, schemeName: b.schemeName, amount: b.amount, frequency: b.frequency, status: b.status },
        ...clientMeta,
      });
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
