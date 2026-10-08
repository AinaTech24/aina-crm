/**
 * AMFI NAV feed ingestion.
 *
 * AMFI publishes the NAV of EVERY mutual-fund scheme in India once a day as a
 * single public, auth-free text file. We download it, parse the pipe-delimited
 * rows, and upsert into `scheme_nav` (platform-shared reference data). Folio /
 * transaction valuation then joins on the AMFI scheme code.
 *
 * Feed format (semicolon-delimited, grouped by AMC + category):
 *
 *   Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
 *
 *   Open Ended Schemes(Equity Scheme - Flexi Cap Fund)
 *
 *   Aditya Birla Sun Life Mutual Fund
 *   119551;INF209K01YM2;INF209K01YN0;Aditya Birla Sun Life Flexi Cap Fund - Growth;1834.56;30-May-2026
 *   ...
 *
 * Standalone (no-semicolon) lines are either an AMC name or a category header;
 * we track the most recent AMC name to tag each scheme. Blank lines + the header
 * row are skipped.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { NAV_MAX_AGE_DAYS } from "./nav-age";

/**
 * AMFI moved the feed to portal.amfiindia.com in Aug 2026; the old www host now
 * answers 302. Point at the canonical host directly rather than relying on the
 * redirect surviving.
 */
export const AMFI_NAVALL_URL =
  process.env.AMFI_NAVALL_URL ?? "https://portal.amfiindia.com/spages/NAVAll.txt";

export type NavRecord = {
  schemeCode: string;
  isin: string | null;
  /** Dividend-Reinvestment ISIN (AMFI col 2), kept distinct from `isin`. */
  isinReinvest: string | null;
  schemeName: string;
  amcName: string | null;
  /** "Open Ended" / "Close Ended" / "Interval" — from the section header. */
  schemeType: string | null;
  /** Granular AMFI category from the section header (e.g. "Equity Scheme - Flexi Cap Fund"). */
  schemeCategory: string | null;
  nav: number;
  navDate: string; // ISO yyyy-mm-dd
  /** Phase 3I: the columns exactly as AMFI prints them (no fallback between ISIN columns). */
  isinPayoutGrowth?: string | null;
  plan?: string | null;
  option?: string | null;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Parse AMFI's "30-May-2026" into ISO "2026-05-30", or null if unparseable. */
export function parseAmfiDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${day}`;
}

/** Download the live AMFI feed. Throws on non-200 or network failure. */
export async function fetchNavAll(): Promise<string> {
  const res = await fetch(AMFI_NAVALL_URL, {
    headers: { "user-agent": "mfd-platform/nav-feed" },
    // The feed is ~8MB; give it room.
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`AMFI feed HTTP ${res.status}`);
  return await res.text();
}

/**
 * Minimum plausible scheme count in a healthy AMFI feed. The real feed carries
 * ~14k schemes; anything under this means the upstream format moved or the
 * download was truncated, NOT that India lost its mutual funds.
 */
export const NAV_FEED_MIN_RECORDS = Number(process.env.NAV_FEED_MIN_RECORDS ?? 1000);

// Why a refused feed THROWS rather than writing nothing: in Aug 2026 AMFI
// inserted two columns, the positional parser produced zero rows, and the daily
// job logged "upserted 0 schemes" for 15 days while every firm's AUM silently
// froze at stale prices. A feed that cannot be read must fail loudly.
export type AmfiLayout = "current8" | "legacy6";

/** The two layouts AMFI has published, column by column (normalised header text). */
const LAYOUTS: Record<AmfiLayout, RegExp[]> = {
  current8: [/^scheme code$/, /^isin div payout ?\/ ?isin growth$/, /^isin div reinvestment$/, /^scheme name$/, /^plan$/, /^option$/, /^net asset value$/, /^date$/],
  legacy6: [/^scheme code$/, /^isin div payout ?\/ ?isin growth$/, /^isin div reinvestment$/, /^scheme name$/, /^net asset value$/, /^date$/],
};
const ISIN = /^IN[A-Z0-9]{9}[0-9]$/;
/** What AMFI prints in an ISIN cell that has no ISIN (seen in the real file: "-" 10,583 times, "Redeemed" 9). */
const ISIN_PLACEHOLDER = /^(-+|n\.?a\.?|nil|redeemed)$/i;

export type AmfiRow = {
  schemeCode: string; isinPayoutGrowth: string | null; isinReinvest: string | null; name: string; plan: string | null; option: string | null;
  amcName: string | null; schemeType: string | null; schemeCategory: string | null; nav: number | null; navDate: string | null;
};
export type AmfiAnalysis = {
  layout: AmfiLayout | null; header: string | null; rows: AmfiRow[];
  /** The file's business date: the NAV date most schemes carry (AMFI also lists closed and matured schemes at their last NAV date). */
  feedDate: string | null;
  /** The newest NAV date printed (one ETF can be a day ahead). */
  latestNavDate: string | null;
  /** Schemes whose own NAV date is more than NAV_MAX_AGE_DAYS before the feed date — historical, still listed. */
  historicalNav: number;
  /** ISIN cells AMFI fills with a placeholder ("-", "Redeemed", "N.A.") — no ISIN, not an error. */
  isinPlaceholders: number;
  malformed: number; invalidIsins: number; duplicateCodes: string[]; conflictingDuplicates: string[]; isinOnManyCodes: string[]; errors: string[];
};

/**
 * Read an AMFI NAVAll body STRICTLY (Phase 3I): the header must be one of the
 * two published layouts, column for column, or nothing is accepted; every data
 * row must have the header's column count; ISINs are format-checked; a scheme
 * listed without a NAV ("N.A.") is kept as identity with nav null; duplicate
 * scheme codes and an ISIN printed for more than one scheme code are reported.
 * Pure — no network, no database.
 */
export function analyseNavAll(body: string): AmfiAnalysis {
  const out: AmfiAnalysis = { layout: null, header: null, rows: [], feedDate: null, latestNavDate: null, historicalNav: 0, isinPlaceholders: 0, malformed: 0, invalidIsins: 0, duplicateCodes: [], conflictingDuplicates: [], isinOnManyCodes: [], errors: [] };
  let amc: string | null = null, type: string | null = null, category: string | null = null;
  const text = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (!t.includes(";")) {
      const hm = t.match(/^(open ended|close ended|interval)\b[^(]*\((.+)\)\s*$/i);
      if (hm) { type = hm[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); category = hm[2].trim() || null; continue; }
      if (/^(open ended|close ended|interval)/i.test(t)) { category = null; continue; }
      amc = t;
      continue;
    }
    const cols = t.split(";").map((c) => c.trim());
    if (!out.layout) {
      const norm = cols.map((c) => c.toLowerCase().replace(/\s+/g, " "));
      const hit = (Object.keys(LAYOUTS) as AmfiLayout[]).find((k) => LAYOUTS[k].length === norm.length && LAYOUTS[k].every((re, i) => re.test(norm[i])));
      if (!hit) { out.errors.push(`unrecognised header: ${t.slice(0, 200)}`); return out; }
      out.layout = hit; out.header = t;
      continue;
    }
    if (!/^\d+$/.test(cols[0])) continue; // a repeated header
    const width = LAYOUTS[out.layout].length;
    if (cols.length !== width) { out.malformed++; continue; }
    const cur = out.layout === "current8";
    const isinOf = (v: string) => {
      if (!v) return null;
      if (ISIN_PLACEHOLDER.test(v)) { out.isinPlaceholders++; return null; }
      const u = v.toUpperCase();
      if (!ISIN.test(u)) { out.invalidIsins++; return null; }
      return u;
    };
    const navText = cols[cur ? 6 : 4], dateText = cols[cur ? 7 : 5];
    const nav = Number(navText);
    out.rows.push({
      schemeCode: cols[0], isinPayoutGrowth: isinOf(cols[1]), isinReinvest: isinOf(cols[2]), name: cols[3],
      plan: cur ? cols[4] || null : null, option: cur ? cols[5] || null : null,
      amcName: amc, schemeType: type, schemeCategory: category,
      nav: navText && isFinite(nav) && nav > 0 ? nav : null, navDate: parseAmfiDate(dateText),
    });
  }
  if (!out.layout) { out.errors.push("no header row"); return out; }
  const seen = new Map<string, number>(), isinCodes = new Map<string, Set<string>>();
  for (const r of out.rows) {
    seen.set(r.schemeCode, (seen.get(r.schemeCode) ?? 0) + 1);
    for (const i of [r.isinPayoutGrowth, r.isinReinvest]) if (i) (isinCodes.get(i) ?? isinCodes.set(i, new Set()).get(i)!).add(r.schemeCode);
    if (r.navDate && (!out.latestNavDate || r.navDate > out.latestNavDate)) out.latestNavDate = r.navDate;
  }
  // The business date is the date most schemes carry — never the single newest
  // row, never "today". Closed and matured schemes stay listed at their last NAV.
  const byDate = new Map<string, number>();
  for (const r of out.rows) if (r.navDate) byDate.set(r.navDate, (byDate.get(r.navDate) ?? 0) + 1);
  out.feedDate = [...byDate].sort((x, y) => y[1] - x[1] || (y[0] < x[0] ? -1 : 1))[0]?.[0] ?? null;
  if (out.feedDate) {
    const cutoff = new Date(Date.parse(`${out.feedDate}T00:00:00Z`) - NAV_MAX_AGE_DAYS * 864e5).toISOString().slice(0, 10);
    out.historicalNav = out.rows.filter((r) => r.navDate && r.navDate < cutoff).length;
  }
  out.duplicateCodes = [...seen].filter(([, n]) => n > 1).map(([c]) => c);
  // A code printed twice with the SAME identity and NAV (AMFI repeats a few
  // schemes under two section headers) is one scheme; printed twice with
  // different ISINs, plan, option, NAV or date it is not a clean export.
  const sig = (r: AmfiRow) => JSON.stringify([r.isinPayoutGrowth, r.isinReinvest, r.plan, r.option, r.nav, r.navDate]);
  const dupes = new Set(out.duplicateCodes);
  const firstSig = new Map<string, string>();
  const kept: AmfiRow[] = [];
  for (const r of out.rows) {
    if (!dupes.has(r.schemeCode)) { kept.push(r); continue; }
    const prev = firstSig.get(r.schemeCode);
    if (prev === undefined) { firstSig.set(r.schemeCode, sig(r)); kept.push(r); }
    else if (prev !== sig(r)) out.conflictingDuplicates.push(r.schemeCode);
  }
  out.conflictingDuplicates = [...new Set(out.conflictingDuplicates)];
  out.rows = kept;
  out.isinOnManyCodes = [...isinCodes].filter(([, c]) => c.size > 1).map(([i]) => i);
  return out;
}

/** The composite name the CRM has always stored (name, plan, option) — kept for compatibility. */
const compositeName = (r: AmfiRow) => [r.name, r.plan ?? "", r.option ?? ""].map((s) => s.trim()).filter(Boolean).join(" - ");

export type NavImportResult = {
  id: string; status: "applied" | "rejected"; reason?: string; sha256: string; layout: AmfiLayout | null; feedDate: string | null;
  schemes: number; withNav: number; withoutNav: number; written: number; keptNewer: number; duplicateCodes: number; isinOnManyCodes: number; stale: boolean;
  /** Firms whose registrar scheme codes were re-decided against this feed. */
  firmsRedecided?: number;
};

export { NAV_MAX_AGE_DAYS } from "./nav-age";
const isoDaysAgo = (n: number, from = new Date()) => new Date(from.getTime() - n * 864e5).toISOString().slice(0, 10);

/**
 * Apply one AMFI NAVAll file — downloaded, or an authentic export supplied as
 * a file (`scripts/amfi-import.ts`) where the host cannot reach AMFI. Every
 * attempt is recorded in amfi_feed_imports with the file's SHA-256.
 *
 * Refused (nothing written): an unrecognised layout, fewer than
 * NAV_FEED_MIN_RECORDS schemes, a date in the future, a scheme code printed
 * twice with different contents (an identical repeat is read once).
 * A file older than NAV_MAX_AGE_DAYS is refused unless `allowStale` (a
 * deliberately historical export) — and even then it never overwrites a newer
 * NAV or identity: every row updates only where its date is not older than the
 * stored one. The NAV date is stored as printed; readers decide what is current.
 */
export async function importNavAll(body: string, opts: { source: "download" | "file"; sourceRef?: string | null; by?: string | null; note?: string | null; allowStale?: boolean; today?: string }): Promise<NavImportResult> {
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(body, "utf8").digest("hex");
  const a = analyseNavAll(body);
  const priced = a.rows.filter((r) => r.nav != null && r.navDate);
  const unpriced = a.rows.filter((r) => r.nav == null || !r.navDate);
  const today = opts.today ?? new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const stale = !!a.feedDate && a.feedDate < isoDaysAgo(NAV_MAX_AGE_DAYS, new Date(`${today}T00:00:00Z`));
  const reason =
    a.errors[0] ? a.errors[0]
    : priced.length < NAV_FEED_MIN_RECORDS ? `only ${priced.length} schemes with a NAV (expected >= ${NAV_FEED_MIN_RECORDS}) — truncated or changed`
    : a.latestNavDate && a.latestNavDate > isoDaysAgo(-1, new Date(`${today}T00:00:00Z`)) ? `a NAV is dated ${a.latestNavDate}, in the future`
    : a.conflictingDuplicates.length ? `${a.conflictingDuplicates.length} scheme code(s) listed twice with different ISINs, plan, option or NAV — the file is not a clean AMFI export`
    : stale && !opts.allowStale ? `feed date ${a.feedDate} is older than ${NAV_MAX_AGE_DAYS} days — pass allowStale for a deliberately historical export`
    : null;
  const base = {
    source: opts.source, sourceRef: opts.sourceRef ?? null, sha256, bytes: Buffer.byteLength(body, "utf8"), header: a.header, layout: a.layout, feedDate: a.feedDate,
    rowsTotal: a.rows.length + a.malformed, schemes: a.rows.length, withNav: priced.length, withoutNav: unpriced.length,
    duplicateCodes: a.duplicateCodes.length, isinOnManyCodes: a.isinOnManyCodes.length,
  };
  return withSystem(async (tx) => {
    if (reason) {
      const r = (await tx.execute(sql`
        INSERT INTO amfi_feed_imports (source, source_ref, sha256, bytes, header, layout, feed_date, rows_total, schemes, with_nav, without_nav, duplicate_codes, isin_on_many_codes, status, reject_reason, imported_by, note)
        VALUES (${base.source}, ${base.sourceRef}, ${sha256}, ${base.bytes}, ${base.header}, ${base.layout}, ${base.feedDate}::date, ${base.rowsTotal}, ${base.schemes}, ${base.withNav}, ${base.withoutNav},
                ${base.duplicateCodes}, ${base.isinOnManyCodes}, 'rejected', ${reason}, ${opts.by ?? null}::uuid, ${opts.note ?? null})
        RETURNING id::text`)).rows[0] as { id: string };
      return { id: r.id, status: "rejected", reason, sha256, layout: a.layout, feedDate: a.feedDate, schemes: a.rows.length, withNav: priced.length, withoutNav: unpriced.length, written: 0, keptNewer: 0, duplicateCodes: a.duplicateCodes.length, isinOnManyCodes: a.isinOnManyCodes.length, stale };
    }
    let written = 0;
    for (let i = 0; i < priced.length; i += 500) {
      const batch = priced.slice(i, i + 500);
      const values = sql.join(batch.map((r) => sql`(${r.schemeCode}, ${r.isinPayoutGrowth ?? r.isinReinvest}, ${r.isinReinvest}, ${r.isinPayoutGrowth}, ${compositeName(r)}, ${r.plan}, ${r.option},
        ${r.amcName}, ${r.schemeType}, ${r.schemeCategory}, ${r.nav}, ${r.navDate}::date, ${a.feedDate}::date, now())`), sql`, `);
      const res = await tx.execute(sql`
        INSERT INTO scheme_nav (scheme_code, isin, isin_reinvest, isin_payout_growth, scheme_name, plan, option_name, amc_name, scheme_type, scheme_category, nav, nav_date, last_seen_feed, updated_at)
        VALUES ${values}
        ON CONFLICT (scheme_code) DO UPDATE SET
          isin = EXCLUDED.isin, isin_reinvest = EXCLUDED.isin_reinvest, isin_payout_growth = EXCLUDED.isin_payout_growth,
          scheme_name = EXCLUDED.scheme_name, plan = EXCLUDED.plan, option_name = EXCLUDED.option_name, amc_name = EXCLUDED.amc_name,
          scheme_type = COALESCE(EXCLUDED.scheme_type, scheme_nav.scheme_type), scheme_category = COALESCE(EXCLUDED.scheme_category, scheme_nav.scheme_category),
          nav = EXCLUDED.nav, nav_date = EXCLUDED.nav_date,
          first_seen_feed = COALESCE(scheme_nav.first_seen_feed, EXCLUDED.last_seen_feed),
          last_seen_feed = GREATEST(scheme_nav.last_seen_feed, EXCLUDED.last_seen_feed), updated_at = now()
        WHERE scheme_nav.nav_date <= EXCLUDED.nav_date`);
      written += res.rowCount ?? 0;
    }
    // A scheme the feed lists WITHOUT a NAV is still listed — it is not
    // inactive — but its stored NAV is not refreshed (its old date stays, so
    // readers treat it as stale). Only for a file that is the newest seen.
    const unpricedCodes = a.rows.filter((r) => r.nav == null || !r.navDate).map((r) => r.schemeCode);
    if (unpricedCodes.length) {
      await tx.execute(sql`
        UPDATE scheme_nav SET last_seen_feed = ${a.feedDate}::date, updated_at = now()
         WHERE scheme_code IN (${sql.join(unpricedCodes.map((c) => sql`${c}`), sql`, `)})
           AND (last_seen_feed IS NULL OR last_seen_feed < ${a.feedDate}::date)`);
    }
    // New rows get their first-seen date too.
    await tx.execute(sql`UPDATE scheme_nav SET first_seen_feed = last_seen_feed WHERE first_seen_feed IS NULL AND last_seen_feed IS NOT NULL`);
    const unpricedJson = unpriced.map((r) => ({ code: r.schemeCode, isinPayoutGrowth: r.isinPayoutGrowth, isinReinvest: r.isinReinvest, name: r.name, plan: r.plan, option: r.option, amc: r.amcName }));
    const row = (await tx.execute(sql`
      INSERT INTO amfi_feed_imports (source, source_ref, sha256, bytes, header, layout, feed_date, rows_total, schemes, with_nav, without_nav, duplicate_codes, isin_on_many_codes, written, kept_newer, unpriced, status, imported_by, note)
      VALUES (${base.source}, ${base.sourceRef}, ${sha256}, ${base.bytes}, ${base.header}, ${base.layout}, ${base.feedDate}::date, ${base.rowsTotal}, ${base.schemes}, ${base.withNav}, ${base.withoutNav},
              ${base.duplicateCodes}, ${base.isinOnManyCodes}, ${written}, ${priced.length - written}, ${JSON.stringify(unpricedJson)}::jsonb, 'applied', ${opts.by ?? null}::uuid, ${opts.note ?? null})
      RETURNING id::text`)).rows[0] as { id: string };
    // Registrar codes are decided against the feed: re-decide every firm's
    // codes now (a scheme may have become inactive, an ISIN may now resolve).
    const { redecideEverywhere } = await import("@/lib/rta/scheme-resolution");
    const re = await redecideEverywhere(tx);
    return { id: row.id, status: "applied", firmsRedecided: re.firms, sha256, layout: a.layout, feedDate: a.feedDate, schemes: a.rows.length, withNav: priced.length, withoutNav: unpriced.length, written, keptNewer: priced.length - written, duplicateCodes: a.duplicateCodes.length, isinOnManyCodes: a.isinOnManyCodes.length, stale };
  });
}

/**
 * Full pipeline: fetch → validate → apply (importNavAll). Returns a summary.
 *
 * THROWS when the file is refused. This is deliberate: in Aug 2026 AMFI
 * inserted two columns, the positional parser produced zero rows, and the
 * daily job logged a cheerful "upserted 0 schemes" for 15 days while every
 * tenant's AUM silently froze at stale prices. A pipeline that writes nothing
 * must fail loudly, not succeed quietly — the caller's error path surfaces it.
 */
export async function refreshNav(): Promise<{ fetched: number; written: number; navDate: string | null }> {
  const body = await fetchNavAll();
  const r = await importNavAll(body, { source: "download", sourceRef: AMFI_NAVALL_URL });
  if (r.status === "rejected") {
    throw new Error(`AMFI feed refused — scheme_nav was NOT updated: ${r.reason}`);
  }
  return { fetched: r.withNav, written: r.written, navDate: r.feedDate };
}
