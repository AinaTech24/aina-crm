import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/discovery/:id/share — mint a client link (/fd/<token>) for the
 * lead/client to fill the discovery before the meeting. Returns the URL once,
 * plus the subject's name, mobile and email so the RM can send it by WhatsApp
 * or email from their own phone. Marks the discovery 'shared'.
 *
 * A new link cancels the ones before it: a client forwarded an old link, or
 * holding two, would otherwise fill in a copy the RM is no longer looking at.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { financialDiscoveries, shareTokens, tenants } from "@/db/schema";
import { createShareToken } from "@/lib/share-tokens";
import { syncDiscoveryPrefill } from "@/lib/discovery/prefill";
import { discoveryScopeSql } from "@/lib/discovery/access";

export const dynamic = "force-dynamic";

const VIEW_CAPS = ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"] as const;

const Body = z.object({ expiresInDays: z.number().int().min(1).max(60).default(14) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const { id } = await params;
    const { expiresInDays } = Body.parse(await req.json().catch(() => ({})));

    const found = await withTenant(session.tenantId, async (tx) => {
      const d = (await tx.select().from(financialDiscoveries)
        .where(and(eq(financialDiscoveries.id, id), await discoveryScopeSql(tx, session))).limit(1))[0];
      if (!d) return null;
      // The client's link opens on the same prefilled form the RM sees.
      await syncDiscoveryPrefill(tx, d as any);
      // Cancel the earlier, unused links to this fact-find.
      await tx
        .update(shareTokens)
        .set({ revokedAt: new Date() } as any)
        .where(and(
          eq(shareTokens.kind, "financial_discovery"),
          sql`${shareTokens.payload}->>'discoveryId' = ${id}`,
          isNull(shareTokens.usedAt),
          isNull(shareTokens.revokedAt),
        ));
      const table = d.subjectType === "lead" ? "leads" : "investors";
      const who = (await tx.execute(sql`
        SELECT name, phone, email FROM ${sql.raw(table)}
         WHERE id = ${d.subjectId}::uuid AND tenant_id = ${session.tenantId}::uuid LIMIT 1
      `)).rows[0] as { name?: string; phone?: string; email?: string } | undefined;
      const firm = (await tx.select({ name: tenants.displayName }).from(tenants)
        .where(eq(tenants.id, session.tenantId)).limit(1))[0];
      return { disc: d, who, firmName: firm?.name ?? null };
    });
    if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { disc, who, firmName } = found;

    const link = await createShareToken({
      tenantId: session.tenantId,
      kind: "financial_discovery",
      subjectType: disc.subjectType as "lead" | "investor",
      subjectId: disc.subjectId,
      payload: { discoveryId: id },
      expiresInDays,
      createdBy: session.userId,
    });

    await withTenant(session.tenantId, (tx) =>
      tx
        .update(financialDiscoveries)
        .set({ status: disc.status === "draft" ? "shared" : disc.status, sharedAt: new Date(), lastShareTokenId: link.id, updatedAt: new Date() } as any)
        .where(and(eq(financialDiscoveries.id, id), eq(financialDiscoveries.tenantId, session.tenantId)))
    );

    return NextResponse.json({
      url: link.url,
      expiresAt: link.expiresAt,
      recipient: { name: who?.name ?? null, phone: who?.phone ?? null, email: who?.email ?? null },
      firmName,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
