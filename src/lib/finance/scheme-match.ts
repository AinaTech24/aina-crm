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
import { schemeHouse, schemeNameKey } from "./scheme-name-key";

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
  /** Every scheme with its name words, for lookupNavFuzzy. */
  all?: Array<NavEntry & { name: string; words: Set<string>; direct: boolean }>;
  /** ISIN (either of a scheme's two AMFI columns) → entry, or null where two
   *  scheme codes claim one ISIN and their NAVs disagree. */
  byIsin?: Map<string, NavEntry | null>;
  /** Schemes AMFI's NAVAll does not list but mfapi.in does, with a NAV no older
   *  than MFAPI_MAX_AGE_DAYS. Consulted only after every AMFI route has failed,
   *  so it can never change a price AMFI could give. */
  fallback?: NavIndex;
  size: number;
};

/** One scheme as the index builder wants it. `alt_name` is the same AMFI code's
 *  name in mf_schemes (mfapi.in), which always spells out plan and option. */
export type NavSourceRow = {
  scheme_code: string | null;
  scheme_name: string | null;
  nav: string | number;
  nav_date: string | Date | null;
  isin?: string | null;
  isin_reinvest?: string | null;
  alt_name?: string | null;
};

/** A mfapi NAV older than this is not offered as a price: the holding is live at
 *  the registrar, so a months-old NAV would be worse than the statement's own. */
export const MFAPI_MAX_AGE_DAYS = 45;

const PLAN_OR_OPTION = /\b(direct|regular|growth|idcw|dividend|bonus|payout|reinvest\w*|cumulative|income distribution)\b/i;

/**
 * The name to index a scheme under. AMFI's feed sometimes leaves its Plan and
 * Option columns EMPTY (Motilal Oswal Large Cap [127LCGP], Business Cycle
 * [127BCGP]): the row says only "Motilal Oswal Large Cap Fund", and the parser
 * cannot tell regular from direct or growth from IDCW — all four codes land
 * under one key and the lookup (rightly) refuses to choose. mf_schemes carries
 * the same AMFI code under a name that does say. Borrow it, but only when the
 * AMFI name states neither plan nor option AND every word of it appears in the
 * mfapi name — the same scheme, just fully named.
 */
export function indexName(amfiName: string | null | undefined, altName: string | null | undefined): string {
  const name = String(amfiName ?? "");
  const alt = String(altName ?? "");
  if (!alt || PLAN_OR_OPTION.test(name) || !PLAN_OR_OPTION.test(alt)) return name;
  const a = schemeNameKey(name);
  const b = schemeNameKey(alt);
  if (!a || !b) return name;
  const have = new Set(b.tokens.split(" "));
  // "growth" is invented by schemeNameKey for a name with no option word.
  const own = a.tokens.split(" ").filter((t) => t !== "growth");
  return own.every((t) => have.has(t)) ? alt : name;
}

const toIsoDate = (d: string | Date | null): string | null =>
  d == null ? null : String(d instanceof Date ? d.toISOString() : d).slice(0, 10);

/** Pure: index a set of scheme rows. `loadNavIndex` is this plus two queries. */
export function buildNavIndex(rows: NavSourceRow[], extra: NavSourceRow[] = []): NavIndex {
  const byCode = new Map<string, NavEntry>();
  const byName = new Map<string, NavEntry | null>();
  const byKey: NonNullable<NavIndex["byKey"]> = new Map();
  const all: NonNullable<NavIndex["all"]> = [];
  const byIsin: NonNullable<NavIndex["byIsin"]> = new Map();

  const addIsin = (isin: string | null | undefined, entry: NavEntry) => {
    const k = String(isin ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(k)) return;
    const prev = byIsin.get(k);
    if (prev === undefined) byIsin.set(k, entry);
    else if (prev && prev.code !== entry.code) {
      // Two codes, one ISIN (a scheme re-coded): the one with the newer NAV
      // stands; a tie on date with different NAVs is a coin flip, so refuse.
      if ((entry.navDate ?? "") > (prev.navDate ?? "")) byIsin.set(k, entry);
      else if ((entry.navDate ?? "") === (prev.navDate ?? "") && Math.abs(entry.nav - prev.nav) / prev.nav > 0.001) byIsin.set(k, null);
    }
  };

  for (const r of rows) {
    const nav = Number(r.nav);
    if (r.scheme_code == null || !isFinite(nav) || nav <= 0) continue;
    const entry: NavEntry = { code: String(r.scheme_code), nav, navDate: toIsoDate(r.nav_date) };
    byCode.set(entry.code, entry);
    addIsin(r.isin, entry);
    addIsin(r.isin_reinvest, entry);

    const name = indexName(r.scheme_name, r.alt_name);
    const sk = schemeNameKey(name);
    if (sk) {
      const k = `${sk.tokens}|${sk.direct ? "d" : "r"}`;
      byKey.set(k, [...(byKey.get(k) ?? []), { ...entry, name }]);
      all.push({ ...entry, name, words: new Set(sk.tokens.split(" ")), direct: sk.direct });
    }

    const key = normSchemeName(name);
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
  const index: NavIndex = { byCode, byName, byKey, all, byIsin, size: byCode.size };
  if (extra.length) {
    const fb = buildNavIndex(extra);
    if (fb.size) index.fallback = fb;
  }
  return index;
}

/** One pull of the platform-shared NAV master, indexed both ways. */
export async function loadNavIndex(tx: Tx): Promise<NavIndex> {
  const res = await tx.execute(
    sql`SELECT n.scheme_code, n.scheme_name, n.nav, n.nav_date, n.isin, n.isin_reinvest, m.scheme_name AS alt_name
          FROM scheme_nav n LEFT JOIN mf_schemes m ON m.scheme_code = n.scheme_code
         WHERE n.nav IS NOT NULL`
  );
  // Second source for what AMFI does not list: mfapi.in's catalog (synced daily,
  // NAV refreshed every ~20 days — hence the age cap).
  const extra = await tx.execute(
    sql`SELECT m.scheme_code, m.scheme_name, m.nav, m.nav_date, m.isin
          FROM mf_schemes m
         WHERE m.nav IS NOT NULL AND m.nav > 0 AND m.is_active
           AND m.nav_date >= current_date - ${MFAPI_MAX_AGE_DAYS}::int
           AND NOT EXISTS (SELECT 1 FROM scheme_nav n WHERE n.scheme_code = m.scheme_code)`
  );
  return buildNavIndex(res.rows as NavSourceRow[], extra.rows as NavSourceRow[]);
}

export type NavHit = NavEntry & { via: "code" | "name" | "key" | "nav" | "isin" | "mfapi" };

/**
 * The candidate whose NAV is nearest the registrar statement's own NAV — the
 * one fact that tells apart AMFI schemes sharing a name ("HSBC Multi Cap Fund -
 * Regular Plan - Growth" is two codes, NAV 19.81 and 16.28; the statement said
 * 19.74). Within 10% (a statement is a few weeks old) and clearly nearer than
 * the runner-up, or null.
 */
function nearestByNav<T extends NavEntry>(cands: T[], hint: number): T | null {
  const scored = cands
    .map((c) => ({ c, d: Math.abs(c.nav - hint) / hint }))
    .filter((x) => x.d <= 0.1)
    .sort((a, b) => a.d - b.d);
  if (!scored.length) return null;
  // Everything in reach is ONE price (a growth and an IDCW option of a scheme that
  // has never paid out; Axis Children's lock-in and no-lock-in at 25.4945 / 25.4914):
  // which of them it is cannot change the valuation. Only when NOTHING else is in
  // reach — a regular plan 3% under its direct twin is another price, and refused.
  const first = scored[0].c.nav;
  if (scored.length > 1 && scored.every((x) => Math.abs(x.c.nav - first) / first <= 0.0005)) return scored[0].c;
  if (scored.length > 1 && scored[1].d < Math.max(scored[0].d * 2, 0.005)) return null;
  return scored[0].c;
}

/**
 * No AMFI scheme has the registrar name's key ("HDFC Childrens Fund (Lock-In)
 * - Regular Plan'", a name the registrar cut off mid-word): the scheme of the
 * same fund house, same plan, sharing most of its words, whose NAV is near the
 * statement's — only when exactly one fits. Needs the statement's NAV.
 *
 * This is the matcher as deployed, and it is the FALLBACK. Its word overlap counts
 * the house name and "Growth", so it finds true renames the stricter by-words match
 * cannot (Axis Bluechip -> Axis Large Cap, Quant Active -> Quant Multi Cap: 805
 * legs, Rs 37.7 Cr on 16 Oct 2026) but also picks a sibling whose NAV happens to
 * agree (Nippon Focused Equity -> Nippon ELSS, WhiteOak Ultra Short -> WhiteOak
 * Liquid, UTI Dividend Yield -> UTI Liquid IDCW). lookupNavFuzzyByWords runs first;
 * this only gets what that one refuses.
 */
export function lookupNavFuzzy(index: NavIndex, schemeName: string | null | undefined, hintNav: number): NavHit | null {
  const sk = schemeNameKey(schemeName);
  if (!sk || !index.all?.length || !(hintNav > 0)) return null;
  const words = new Set(sk.tokens.split(" "));
  const house = String(schemeName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")[0];
  const near = index.all.filter((c) => {
    if (c.direct !== sk.direct || !c.words.has(house)) return false;
    let shared = 0;
    for (const w of words) if (c.words.has(w)) shared++;
    return shared / Math.max(words.size, c.words.size) >= 0.5;
  });
  const newest = near.reduce((m, c) => ((c.navDate ?? "") > m ? (c.navDate ?? "") : m), "");
  const hit = nearestByNav(near.filter((c) => (c.navDate ?? "") === newest), hintNav);
  if (!hit) return null;
  return { code: hit.code, nav: hit.nav, navDate: hit.navDate, via: "nav" };
}

/**
 * No AMFI scheme has the registrar name's key. Two ways that happens: the
 * registrar cut the name off mid-word ("HDFC Childrens Fund (Lock-In) - Regular
 * Plan'"), or the fund was RENAMED and the registrar still prints the old name
 * ("ICICI Prudential Dividend Yield Equity Fund" -> "...Dividend Yield Fund";
 * "Kotak Global Emerging Market Overseas Equity Omni FOF" -> "...Active FOF";
 * "Old Bridge Focused Equity Fund" -> "Old Bridge Focused Fund").
 *
 * Similarity is scored on the words that make a fund THIS fund: the house name
 * ("ICICI Prudential" is in nearly every ICICI scheme) and the option words
 * ("Growth") are set aside first, because counting them lets "ICICI Prudential
 * Quant Fund" look 60% like "ICICI Prudential Value Fund" and a coincidence of
 * NAV then decides. Candidates are ranked on that overlap FIRST and only the top
 * tier — within 0.1 of the best, so a near-tie stays a tie — goes on to the NAV
 * test: exactly one of them must sit near the statement's NAV. Needs the
 * statement's NAV.
 */
export function lookupNavFuzzyByWords(index: NavIndex, schemeName: string | null | undefined, hintNav: number): NavHit | null {
  const sk = schemeNameKey(schemeName);
  if (!sk || !index.all?.length || !(hintNav > 0)) return null;
  const house = schemeHouse(schemeName);
  const mineWords = new Set(sk.tokens.split(" "));
  const optionOf = (w: Set<string>) => (w.has("idcw") ? "idcw" : w.has("bonus") ? "bonus" : "growth");
  // Same plan AND same option: a Growth holding is never an IDCW scheme.
  let ofHouse = index.all.filter((c) => c.direct === sk.direct && c.words.has(house) && optionOf(c.words) === optionOf(mineWords));
  // A scheme whose NAV has stopped publishing is not a rename target.
  const latest = ofHouse.reduce((m, c) => ((c.navDate ?? "") > m ? (c.navDate ?? "") : m), "");
  ofHouse = ofHouse.filter((c) => daysBetween(c.navDate, latest) <= 10);
  if (!ofHouse.length) return null;
  // Words in at least half of the house's schemes are the house's name, not a fund's.
  // Too few schemes to tell (a hand-built index): only the house word itself.
  const df = new Map<string, number>();
  for (const c of ofHouse) for (const w of c.words) df.set(w, (df.get(w) ?? 0) + 1);
  const generic = (w: string) => w === house || FUZZY_OPTION_WORDS.has(w) || (ofHouse.length >= 12 && (df.get(w) ?? 0) / ofHouse.length >= 0.5);
  const specific = (words: Set<string>) => new Set([...words].filter((w) => !generic(w)));
  const mine = specific(mineWords);
  if (!mine.size) return null;
  const scored: Array<{ c: NonNullable<NavIndex["all"]>[number]; j: number }> = [];
  for (const c of ofHouse) {
    const theirs = specific(c.words);
    if (!theirs.size) continue;
    let shared = 0;
    for (const w of mine) if (theirs.has(w)) shared++;
    const j = shared / (mine.size + theirs.size - shared);
    if (shared > 0 && j >= 0.5) scored.push({ c, j });
  }
  if (!scored.length) return null;
  const best = Math.max(...scored.map((x) => x.j));
  const tier = scored.filter((x) => x.j >= best - 0.1).map((x) => x.c);
  // A scheme whose NAV has stopped publishing must not outrank a live one.
  const newest = tier.reduce((m, c) => ((c.navDate ?? "") > m ? (c.navDate ?? "") : m), "");
  const live = tier.filter((c) => daysBetween(c.navDate, newest) <= 10);
  const hit = nearestByNav(live, hintNav);
  if (!hit) return null;
  return { code: hit.code, nav: hit.nav, navDate: hit.navDate, via: "nav" };
}

const FUZZY_OPTION_WORDS = new Set([
  "growth", "idcw", "bonus", "payout", "reinvest",
  // A registrar's tag on the name, not part of the fund's identity:
  // "HDFC Childrens Fund (Lock-In)", "(Close Ended)", "(Interval)".
  "lock", "in", "close", "closed", "ended", "interval",
]);

function daysBetween(a: string | null, b: string): number {
  if (!a || !b) return a === b ? 0 : Infinity;
  return Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000;
}

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
export function lookupNavByKey(index: NavIndex, schemeName: string | null | undefined, hintNav?: number | null): NavHit | null {
  const sk = schemeNameKey(schemeName);
  if (!sk) return null;
  let cands = index.byKey?.get(`${sk.tokens}|${sk.direct ? "d" : "r"}`) ?? [];
  if (!cands.length) return null;
  const newest = cands.reduce((m, c) => ((c.navDate ?? "") > m ? (c.navDate ?? "") : m), "");
  cands = cands.filter((c) => (c.navDate ?? "") === newest);
  // A statement's own NAV settles which of several same-named schemes it is.
  if (cands.length > 1 && hintNav && hintNav > 0) {
    const near = nearestByNav(cands, hintNav);
    if (near) return { code: near.code, nav: near.nav, navDate: near.navDate, via: "key" };
  }
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
 * Price one stored leg. ISIN first (exact, and the only thing that tells a
 * regular plan from a direct one when AMFI leaves its plan columns blank), then
 * the code (authoritative), then the canonical name. Returns null when none
 * resolves, or when the name is ambiguous. When AMFI cannot price it at all the
 * same routes run once more against mfapi.in's catalog.
 */
export function lookupNav(
  index: NavIndex,
  schemeCode: string | null | undefined,
  schemeName: string | null | undefined,
  /** The NAV a registrar statement printed for this holding, when there is one. */
  hintNav?: number | null,
  /** The ISIN the registrar's file carried for this holding, when it did. */
  isin?: string | null,
): NavHit | null {
  const hit = lookupIn(index, schemeCode, schemeName, hintNav, isin);
  if (hit || !index.fallback) return hit;
  const fb = lookupIn(index.fallback, schemeCode, schemeName, hintNav, isin);
  return fb ? { ...fb, via: "mfapi" } : null;
}

function lookupIn(
  index: NavIndex,
  schemeCode: string | null | undefined,
  schemeName: string | null | undefined,
  hintNav?: number | null,
  isin?: string | null,
): NavHit | null {
  const hint = hintNav && hintNav > 0 ? hintNav : null;
  if (isin) {
    const byIsin = index.byIsin?.get(String(isin).trim().toUpperCase());
    if (byIsin) return { ...byIsin, via: "isin" };
  }
  if (schemeCode) {
    const byCode = index.byCode.get(String(schemeCode));
    if (byCode) return { ...byCode, via: "code" };
  }
  // A name match whose NAV is far from the statement's is another option or
  // plan of the scheme (Growth vs IDCW, Regular vs Direct): not this holding.
  const plausible = (h: NavHit | null) => (h && hint && Math.abs(h.nav - hint) / hint > 0.25 ? null : h);
  const key = normSchemeName(schemeName);
  if (key) {
    const byName = index.byName.get(key);
    const h = plausible(byName ? { ...byName, via: "name" } : null);
    if (h) return h;
  }
  const byKey = plausible(lookupNavByKey(index, schemeName, hint));
  if (byKey) return byKey;
  return hint ? (lookupNavFuzzyByWords(index, schemeName, hint) ?? lookupNavFuzzy(index, schemeName, hint)) : null;
}
