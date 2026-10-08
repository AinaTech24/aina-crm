/**
 * Match a stored holding to the AMFI NAV master.
 *
 * `scheme_nav` is the daily AMFI NAVAll feed, keyed by AMFI's own numeric
 * scheme code. RTA files identify the same scheme by the REGISTRAR's internal
 * product code — `Y1035`, `FTI047`, `RMFGFGP` — so a lookup keyed on code alone
 * misses every holding the holdings/AUM importer wrote, and those legs keep
 * whatever value the import gave them, for ever.
 *
 * Measured on VSN Financial Services (ARN-90577) on 2026-09-30: 17,637 of
 * 19,867 stored legs had no code match, covering Rs 544.98 Cr of a Rs 627.42 Cr
 * book. The firm's AUM moved by a few lakh a day — the 13% that did match —
 * while 87% sat at its last imported value. Franklin, Nippon, SBI, ICICI, Birla
 * and Invesco were all in the unmatched set, so this was never an edge case.
 *
 * The rich importer already resolves codes to AMFI's via
 * `lib/rta/resolve-scheme.ts` (ISIN first, then name). This module is the same
 * idea for holdings that are ALREADY STORED, where the ISIN is not kept on the
 * leg — so the name is all there is to match on.
 *
 * One normalisation, used by both the nightly revaluation and the backfill
 * script. If they normalised differently, the backfill would rewrite codes the
 * runtime could not then price.
 */

import { sql } from "drizzle-orm";
import { schemeNameKey } from "./scheme-name-key";

type Tx = any;

/** Lower-case, alphanumerics only, collapse whitespace. Deliberately KEEPS
 *  plan/option words ("Direct", "Growth", "IDCW") so a match is plan-specific —
 *  pricing a Regular plan at the Direct plan's NAV would be a silent error far
 *  worse than not pricing it at all. Same rule as `lib/rta/resolve-scheme.ts`. */
export function normSchemeName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type NavEntry = { code: string; nav: number; navDate: string | null };

export type NavIndex = {
  byCode: Map<string, NavEntry>;
  /** Normalised name → entry, or null where the name is AMBIGUOUS (two scheme
   *  codes share it). Ambiguity is stored rather than dropped so a lookup can
   *  tell "no such name" from "refused to guess". */
  byName: Map<string, NavEntry | null>;
  /** schemeNameKey → every AMFI scheme with that key (see lookupNavByKey).
   *  Optional so an index built by hand (tests) without it still works. */
  byKey?: Map<string, Array<NavEntry & { name: string }>>;
  size: number;
};

/** One pull of the platform-shared NAV master, indexed both ways. */
export async function loadNavIndex(tx: Tx): Promise<NavIndex> {
  const res = await tx.execute(
    sql`SELECT scheme_code, scheme_name, nav, nav_date FROM scheme_nav WHERE nav IS NOT NULL`
  );
  const byCode = new Map<string, NavEntry>();
  const byName = new Map<string, NavEntry | null>();
  const byKey: NonNullable<NavIndex["byKey"]> = new Map();

  for (const r of res.rows as Array<{
    scheme_code: string | null;
    scheme_name: string | null;
    nav: string | number;
    nav_date: string | null;
  }>) {
    const nav = Number(r.nav);
    if (r.scheme_code == null || !isFinite(nav) || nav <= 0) continue;
    const navDate = r.nav_date == null ? null : String((r.nav_date as unknown) instanceof Date ? (r.nav_date as unknown as Date).toISOString() : r.nav_date).slice(0, 10);
    const entry: NavEntry = { code: String(r.scheme_code), nav, navDate };
    byCode.set(entry.code, entry);
    const sk = schemeNameKey(r.scheme_name);
    if (sk) {
      const k = `${sk.tokens}|${sk.direct ? "d" : "r"}`;
      byKey.set(k, [...(byKey.get(k) ?? []), { ...entry, name: String(r.scheme_name ?? "") }]);
    }

    const key = normSchemeName(r.scheme_name);
    if (!key) continue;
    if (!byName.has(key)) {
      byName.set(key, entry);
    } else {
      const existing = byName.get(key);
      // Two different AMFI codes under one name: refuse both. Picking one would
      // be a coin flip, and the backfill would stamp that guess into the data.
      if (existing && existing.code !== entry.code) byName.set(key, null);
    }
  }
  return { byCode, byName, byKey, size: byCode.size };
}

export type NavHit = NavEntry & { via: "code" | "name" | "key" };

/**
 * The AMFI scheme a registrar's name means, by schemeNameKey — the only way to
 * price a transaction carrying the registrar's own product code ("HGFGPG",
 * "K1155", "101EQGP"), which no NAV master knows. On 8 Oct 2026 that was 1,638
 * codes and Rs 3,439 Cr of purchases across every firm, shown as "invested"
 * with no current value.
 *
 * Several AMFI codes can share a key (legacy rows, payout vs reinvestment,
 * a name with the plan left out). In order: keep the ones with the newest NAV
 * (a closed scheme's stops), then the ones whose own name states the plan
 * ("Regular" / "Direct") and an option outright, then accept the rest only if
 * they all carry the same NAV — when they do, which one does not change a
 * valuation. Otherwise null: an unpriced holding beats a wrong one.
 */
export function lookupNavByKey(index: NavIndex, schemeName: string | null | undefined): NavHit | null {
  const sk = schemeNameKey(schemeName);
  if (!sk) return null;
  let cands = index.byKey?.get(`${sk.tokens}|${sk.direct ? "d" : "r"}`) ?? [];
  if (!cands.length) return null;
  const newest = cands.reduce((m, c) => ((c.navDate ?? "") > m ? (c.navDate ?? "") : m), "");
  cands = cands.filter((c) => (c.navDate ?? "") === newest);
  if (cands.length > 1) {
    const explicit = (n: string): number =>
      ((sk.direct ? /\bdirect\b/i : /\bregular\b/i).test(n) ? 1 : 0) +
      (/\b(growth|idcw|dividend|cumulative|bonus)\b/i.test(n) ? 1 : 0);
    const best = Math.max(...cands.map((c) => explicit(c.name)));
    cands = cands.filter((c) => explicit(c.name) === best);
  }
  if (cands.length > 1) {
    const navs = cands.map((c) => c.nav);
    if (Math.max(...navs) / Math.min(...navs) > 1.001) return null;
  }
  const { name: _name, ...entry } = cands[0];
  return { ...entry, via: "key" };
}

/**
 * Price one stored leg. Code first (authoritative), then the canonical name.
 * Returns null when neither resolves, or when the name is ambiguous.
 */
export function lookupNav(
  index: NavIndex,
  schemeCode: string | null | undefined,
  schemeName: string | null | undefined
): NavHit | null {
  if (schemeCode) {
    const byCode = index.byCode.get(String(schemeCode));
    if (byCode) return { ...byCode, via: "code" };
  }
  const key = normSchemeName(schemeName);
  if (key) {
    const byName = index.byName.get(key);
    if (byName) return { ...byName, via: "name" };
  }
  return lookupNavByKey(index, schemeName);
}
