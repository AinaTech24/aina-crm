/**
 * POST /api/leads/[id]/notes
 * Body: { note, activityType?: 'call'|'meeting'|'email'|'whatsapp'|'note'|'other' }
 *
 * Appends a timestamped activity entry to the lead. The latest goes to the top
 * of the followUpNotes field; stage_changed_at + last_contact_at are bumped so
 * the lead doesn't go stale and the missed-follow-up automation doesn't fire.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { leads } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  note: z.string().min(1).max(4000),
  activityType: z.enum(["call", "meeting", "email", "whatsapp", "note", "other"]).default("note"),
  nextFollowUpAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const result = await withTenant(session.tenantId, async (tx) => {
      const lead = (await tx.select().from(leads).where(eq(leads.id, id)).limit(1))[0];
      if (!lead) throw Object.assign(new Error("lead not found"), { status: 404 });

      const ts = new Date();
      const stamp = ts.toISOString().slice(0, 16).replace("T", " ");
      const prefix = `[${stamp} · ${parse.data.activityType}${
        session.name ? " · " + session.name : ""
      }]`;
      const entry = `${prefix}\n${parse.data.note}`;
      const combined = lead.followUpNotes ? `${entry}\n\n---\n\n${lead.followUpNotes}` : entry;

      await tx
        .update(leads)
        .set({
          followUpNotes: combined,
          lastContactAt: ts,
          lastFollowUpAt: ts,
          nextFollowUpAt: parse.data.nextFollowUpAt ? new Date(parse.data.nextFollowUpAt) : lead.nextFollowUpAt,
          updatedAt: ts,
        } as any)
        .where(eq(leads.id, id));

      return { ok: true };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
