/**
 * POST /api/dashboards/[id]/prefs — the caller's OWN preferences for a
 * dashboard they can see. Hard-scoped to session.userId; nothing here changes
 * the dashboard for anyone else.
 *
 *   { favourite: boolean }
 *   { default: true | false }          "Set as my default"
 *   { savedFilters: FilterState|null } "Save filter"
 *   { cardFilter: { instanceId, state: FilterState|null } }   "Filter this card"
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { loadDashboard, saveFilters, setCardFilter, setFavourite, setMyDefault, viewerFacts } from "@/lib/dashboards/platform";
import { sanitizeFilterState } from "@/lib/dashboards/system/filters";

export const dynamic = "force-dynamic";

const Body = z.object({
  favourite: z.boolean().optional(),
  default: z.boolean().optional(),
  savedFilters: z.unknown().optional(),
  cardFilter: z.object({ instanceId: z.string().min(1).max(64), state: z.unknown() }).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
    const b = parsed.data;
    const ok = await withTenant(session.tenantId, async (tx) => {
      const hit = await loadDashboard(tx, await viewerFacts(tx, session), id);
      if (!hit || hit.d.deletedAt) return false;
      if (b.favourite !== undefined) await setFavourite(tx, session, id, b.favourite);
      if (b.default !== undefined) await setMyDefault(tx, session, b.default ? id : null);
      if (b.savedFilters !== undefined) await saveFilters(tx, session, id, sanitizeFilterState(b.savedFilters));
      if (b.cardFilter) await setCardFilter(tx, session, id, b.cardFilter.instanceId, sanitizeFilterState(b.cardFilter.state));
      return true;
    });
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
