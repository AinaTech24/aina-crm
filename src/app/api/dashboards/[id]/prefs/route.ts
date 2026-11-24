/**
 * POST /api/dashboards/[id]/prefs — the caller's OWN preferences for a
 * dashboard they can see. Hard-scoped to session.userId; nothing here changes
 * the dashboard for anyone else.
 *
 *   { favourite: boolean }
 *   { default: true | false }          "Set as my default"
 *   { savedFilter: { op: "create", name, state, setDefault? } }   "Save filter" → a new named one
 *   { savedFilter: { op: "update", id, state?, name? } }           overwrite / rename
 *   { savedFilter: { op: "delete", id } }
 *   { savedFilter: { op: "default", id | null } }                  the one this dashboard opens with
 *   { savedFilters: FilterState|null } the old single "Save filter" (a screen opened before the list)
 *   { cardFilter: { instanceId, state: FilterState|null } }   "Filter this card"
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { changeSavedFilters, loadDashboard, saveFilters, setCardFilter, setFavourite, setMyDefault, viewerFacts } from "@/lib/dashboards/platform";
import { sanitizeFilterState } from "@/lib/dashboards/system/filters";
import type { OpResult, SavedFilterOp } from "@/lib/dashboards/system/saved-filters";

export const dynamic = "force-dynamic";

const Body = z.object({
  favourite: z.boolean().optional(),
  default: z.boolean().optional(),
  savedFilters: z.unknown().optional(),
  savedFilter: z.discriminatedUnion("op", [
    z.object({ op: z.literal("create"), name: z.string().max(200), state: z.unknown(), setDefault: z.boolean().optional() }),
    z.object({ op: z.literal("update"), id: z.string().min(1).max(64), state: z.unknown().optional(), name: z.string().max(200).optional() }),
    z.object({ op: z.literal("delete"), id: z.string().min(1).max(64) }),
    z.object({ op: z.literal("default"), id: z.string().min(1).max(64).nullable() }),
  ]).optional(),
  cardFilter: z.object({ instanceId: z.string().min(1).max(64), state: z.unknown() }).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
    const b = parsed.data;
    // A holder, not a `let`: TypeScript does not see assignments made inside the callback.
    const out: { saved: OpResult | null } = { saved: null };
    const ok = await withTenant(session.tenantId, async (tx) => {
      const hit = await loadDashboard(tx, await viewerFacts(tx, session), id);
      if (!hit || hit.d.deletedAt) return false;
      if (b.favourite !== undefined) await setFavourite(tx, session, id, b.favourite);
      if (b.default !== undefined) await setMyDefault(tx, session, b.default ? id : null);
      if (b.savedFilters !== undefined) await saveFilters(tx, session, id, sanitizeFilterState(b.savedFilters));
      if (b.savedFilter) {
        const f = b.savedFilter;
        // The filter itself is cleaned here, like every stored filter: known fields, bounded lists.
        let op: SavedFilterOp | null = null;
        if (f.op === "create") {
          const state = sanitizeFilterState(f.state);
          if (state) op = { op: "create", name: f.name, state, setDefault: f.setDefault };
        } else if (f.op === "update") {
          const state = f.state === undefined ? undefined : sanitizeFilterState(f.state);
          if (state !== null) op = { op: "update", id: f.id, state, name: f.name };
        } else {
          op = f;
        }
        out.saved = op ? await changeSavedFilters(tx, session, id, op) : { ok: false, status: 400, error: "Invalid filter." };
      }
      if (b.cardFilter) await setCardFilter(tx, session, id, b.cardFilter.instanceId, sanitizeFilterState(b.cardFilter.state));
      return true;
    });
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    const saved = out.saved;
    if (saved && !saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
    if (saved && saved.ok) return NextResponse.json({ ok: true, id: saved.id, items: saved.book.items, defaultId: saved.book.defaultId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
