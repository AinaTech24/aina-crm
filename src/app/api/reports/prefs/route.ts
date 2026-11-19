import { handleApiError } from "@/lib/api/error-handler";
/**
 * The viewer's own standard-report preferences (report_user_prefs, 0277):
 * favourites, recently opened and saved views, kept on the server so they
 * follow the person to any device.
 *   GET  /api/reports/prefs → { favourites: string[], recent: { key, at }[], views: { id, key, name, query }[] }
 *   POST /api/reports/prefs   { favourite: key, on: boolean }
 *                           | { open: key }                  — opened just now
 *                           | { importFavourites: string[] } — one-time carry-over from this device
 *                           | { saveView: { key, name, query } } — a standard report with its filters
 *                           | { deleteView: id }
 * Keys are standard-report catalog keys; anything else is ignored.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { v4 as uuid } from "uuid";
import { REPORTS } from "@/lib/reports/catalog";

export const dynamic = "force-dynamic";

const KNOWN = new Set(REPORTS.flatMap((g) => g.items.map((i) => i.key)));
const MAX_RECENT = 20;
const MAX_VIEWS = 50;
/** Only the standard report filters a view may carry. */
const VIEW_PARAMS = new Set(["period", "from", "to", "rm", "branch"]);

const Body = z.union([
  z.object({ favourite: z.string().max(80), on: z.boolean() }),
  z.object({ open: z.string().max(80) }),
  z.object({ importFavourites: z.array(z.string().max(80)).max(200) }),
  z.object({ saveView: z.object({ key: z.string().max(80), name: z.string().trim().min(1).max(80), query: z.string().max(500) }) }),
  z.object({ deleteView: z.string().uuid() }),
]);

type View = { id: string; key: string; name: string; query: string };
type Prefs = { favourites: string[]; recent: { key: string; at: string }[]; views: View[] };

/** Keep only the filter params a standard report reads, so a view is never an open redirect or junk. */
function cleanQuery(q: string): string {
  const src = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);
  const out = new URLSearchParams();
  for (const [k, v] of src) if (VIEW_PARAMS.has(k) && /^[\w-]{1,60}$/.test(v)) out.set(k, v);
  return out.toString();
}

async function load(tx: any, tenantId: string, userId: string): Promise<Prefs> {
  const r = await tx.execute(sql`SELECT favourites, recent, views FROM report_user_prefs WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid`);
  const row = r.rows[0] as Prefs | undefined;
  return { favourites: row?.favourites ?? [], recent: row?.recent ?? [], views: row?.views ?? [] };
}

export async function GET() {
  try {
    const session = await requireSession();
    const prefs = await withTenant(session.tenantId, (tx) => load(tx, session.tenantId, session.userId));
    return NextResponse.json(prefs);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const body = parse.data;
    const out = await withTenant(session.tenantId, async (tx) => {
      const cur = await load(tx, session.tenantId, session.userId);
      const fav = new Set(cur.favourites.filter((k) => KNOWN.has(k)));
      let recent = cur.recent.filter((r) => KNOWN.has(r.key));
      let views = cur.views;
      if ("favourite" in body) {
        if (!KNOWN.has(body.favourite)) return cur;
        if (body.on) fav.add(body.favourite);
        else fav.delete(body.favourite);
      } else if ("open" in body) {
        if (!KNOWN.has(body.open)) return cur;
        recent = [{ key: body.open, at: new Date().toISOString() }, ...recent.filter((r) => r.key !== body.open)].slice(0, MAX_RECENT);
      } else if ("saveView" in body) {
        if (!KNOWN.has(body.saveView.key)) return cur;
        views = [{ id: uuid(), key: body.saveView.key, name: body.saveView.name, query: cleanQuery(body.saveView.query) }, ...views].slice(0, MAX_VIEWS);
      } else if ("deleteView" in body) {
        views = views.filter((v) => v.id !== body.deleteView);
      } else {
        // Only when the server has none yet, so a second device never overwrites.
        if (fav.size) return cur;
        for (const k of body.importFavourites) if (KNOWN.has(k)) fav.add(k);
      }
      const next: Prefs = { favourites: [...fav], recent, views };
      await tx.execute(sql`
        INSERT INTO report_user_prefs (tenant_id, user_id, favourites, recent, views, updated_at)
        VALUES (${session.tenantId}::uuid, ${session.userId}::uuid, ${JSON.stringify(next.favourites)}::jsonb, ${JSON.stringify(next.recent)}::jsonb, ${JSON.stringify(next.views)}::jsonb, now())
        ON CONFLICT (tenant_id, user_id) DO UPDATE
          SET favourites = EXCLUDED.favourites, recent = EXCLUDED.recent, views = EXCLUDED.views, updated_at = now()
      `);
      return next;
    });
    return NextResponse.json(out);
  } catch (err: any) {
    return handleApiError(err);
  }
}
