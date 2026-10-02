import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/notes — the client's notes, newest first: every
 * entry in the interaction log that carries text (lib/notes/record-notes.ts).
 * A note is added with POST /api/activities (kind "note"), the same route
 * "Log call / visit" uses, so its access rules apply.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadViewableInvestor } from "@/lib/investors/access";
import { loadRecordNotes } from "@/lib/notes/record-notes";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const notes = await withTenant(session.tenantId, async (tx) => {
      const inv = await loadViewableInvestor(tx, session, id);
      if (!inv) return null;
      return loadRecordNotes(tx, session.tenantId, { type: "investor", id });
    });
    if (!notes) return NextResponse.json({ error: "client not found" }, { status: 404 });
    return NextResponse.json({ notes });
  } catch (err: any) {
    return handleApiError(err);
  }
}
