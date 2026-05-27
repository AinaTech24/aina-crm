/**
 * Investor blueprint endpoint.
 *
 *   GET /api/investors/[id]/blueprint → same shape as the lead version
 *
 * The blueprint instance is stored against the *source lead* (the lead that
 * was converted to this investor). We resolve it by looking up the lead
 * whose `converted_investor_id` matches the requested investor.
 *
 * If no source lead exists (e.g. an investor created outside the lead flow),
 * returns 404 — the UI then hides the bar.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getStage } from "@/lib/blueprints/engine";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id: investorId } = await params;
    const data = await withTenant(session.tenantId, async (tx) => {
      // Find the source lead for this investor.
      const lead = await tx.execute(sql`
        SELECT id FROM leads WHERE converted_investor_id = ${investorId}::uuid LIMIT 1
      `);
      const leadId = (lead.rows[0] as any)?.id as string | undefined;
      if (!leadId) {
        return { notFound: true as const };
      }
      const view = await getStage(tx, session.tenantId, leadId);
      // Return the leadId so the client-side stage bar can call
      // /api/leads/[leadId]/blueprint/advance for re-sync / manual moves.
      return { ...view, leadId };
    });
    if ("notFound" in data && data.notFound) {
      return NextResponse.json({ error: "No blueprint found for this client" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
