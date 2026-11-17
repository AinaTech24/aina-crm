import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/mf/schemes/[schemeCode]/nav
 *
 * A scheme's full NAV history from mfapi.in, oldest first — the data every
 * Fund Research tool (src/lib/fund-research) computes on, in the browser.
 * Public market data: requireSession only, no tenant data is read or written.
 *
 *   → { schemeCode, schemeName, amc, category, firstDate, lastDate,
 *       points: [[ "yyyy-mm-dd", nav ], …] }        // ascending
 *
 * Cached in-process for 6 hours per scheme code (a history changes once a
 * business day) and `private, max-age` for the browser, so switching between
 * tools does not re-download it. Errors as the returns route: 400 for a bad
 * code, 404 when mfapi has no usable history.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { fetchMfApiScheme, parseMfApiDate } from "@/lib/finance/mfapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type NavPayload = {
  schemeCode: string;
  schemeName: string;
  amc: string | null;
  category: string | null;
  firstDate: string;
  lastDate: string;
  points: Array<[string, number]>;
};

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;
const cache = new Map<string, { at: number; body: NavPayload }>();

function remember(code: string, body: NavPayload) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(code, { at: Date.now(), body });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ schemeCode: string }> }) {
  const { schemeCode } = await params;
  try {
    await requireSession();
    const code = String(schemeCode).replace(/[^0-9A-Za-z]/g, "").slice(0, 20);
    if (!code) return NextResponse.json({ error: "invalid scheme code" }, { status: 400 });

    const headers = { "Cache-Control": "private, max-age=3600" };
    const hit = cache.get(code);
    if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body, { headers });

    const s = await fetchMfApiScheme(code).catch(() => null);
    if (!s || !Array.isArray(s.data) || s.data.length === 0) {
      return NextResponse.json({ error: "no NAV history" }, { status: 404 });
    }

    const byDate = new Map<string, number>();
    for (const p of s.data) {
      const iso = parseMfApiDate(p.date);
      const nav = Number(p.nav);
      if (iso && Number.isFinite(nav) && nav > 0) byDate.set(iso, nav);
    }
    const points = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (points.length < 2) return NextResponse.json({ error: "insufficient history" }, { status: 404 });

    const body: NavPayload = {
      schemeCode: code,
      schemeName: s.meta?.scheme_name ?? code,
      amc: s.meta?.fund_house ?? null,
      category: s.meta?.scheme_category ?? null,
      firstDate: points[0][0],
      lastDate: points[points.length - 1][0],
      points,
    };
    remember(code, body);
    return NextResponse.json(body, { headers });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
