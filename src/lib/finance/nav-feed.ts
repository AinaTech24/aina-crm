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

/** Where the fields sit on a data row. Legacy AMFI layout is the default. */
type ColumnMap = { nav: number; date: number; plan: number | null; option: number | null };

const LEGACY_COLUMNS: ColumnMap = { nav: 4, date: 5, plan: null, option: null };

/**
 * Bind columns by header name. Returns null when the row isn't a recognisable
 * header, so the caller keeps whatever mapping it already had.
 */
function headerIndices(cols: string[]): ColumnMap | null {
  const norm = cols.map((c) => c.trim().toLowerCase());
  const find = (re: RegExp) => {
    const i = norm.findIndex((c) => re.test(c));
    return i === -1 ? null : i;
  };
  const nav = find(/net asset value|^nav$/);
  const date = find(/^date$/);
  if (nav == null || date == null) return null;
  return { nav, date, plan: find(/^plan$/), option: find(/^option$/) };
}

/**
 * Parse the raw NAVAll.txt body into NavRecords. Pure + synchronous so it's
 * unit-testable without a network call.
 */
export function parseNavAll(body: string): NavRecord[] {
  const out: NavRecord[] = [];
  let currentAmc: string | null = null;
  let currentType: string | null = null;
  let currentCategory: string | null = null;
  let col: ColumnMap = LEGACY_COLUMNS;
  const lines = body.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!trimmed.includes(";")) {
      // Standalone line: a section header ("Open Ended Schemes(Equity Scheme -
      // Flexi Cap Fund)") or an AMC name. A header states the scheme STRUCTURE
      // and the granular CATEGORY — capture both so every scheme below it is
      // tagged, rather than discarding the header as before. Everything else is
      // the current AMC name.
      const hm = trimmed.match(/^(open ended|close ended|interval)\b[^(]*\((.+)\)\s*$/i);
      if (hm) {
        currentType = hm[1]
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase()); // "Open Ended" / "Close Ended" / "Interval"
        currentCategory = hm[2].trim() || null;
        continue;
      }
      // A header keyword with no parenthesised category still isn't an AMC.
      if (/^(open ended|close ended|interval)/i.test(trimmed)) {
        currentCategory = null;
        continue;
      }
      currentAmc = trimmed;
      continue;
    }

    const cols = trimmed.split(";");
    if (cols.length < 6) continue;

    // The header row names the columns. AMFI changed the layout in Aug 2026 —
    // "Plan" and "Option" were inserted before the NAV, shifting nav/date from
    // index 4/5 to 6/7. A positional parser silently produced ZERO records for
    // 15 days (Number("Direct Plan") is NaN, so every row was skipped) and the
    // whole platform valued portfolios at stale NAVs. So bind the columns by
    // header name and only fall back to the legacy positions when there is no
    // header to read.
    if (!/^\d+$/.test(cols[0].trim())) {
      const idx = headerIndices(cols);
      if (idx) col = idx;
      continue; // header row itself carries no data
    }

    const schemeCode = cols[0].trim();

    const nav = Number(cols[col.nav]?.trim());
    if (!isFinite(nav) || nav <= 0) continue; // "N.A." or suspended schemes

    const navDate = parseAmfiDate(cols[col.date] ?? "");
    if (!navDate) continue;

    out.push({
      schemeCode,
      // Primary keeps the existing fallback (some schemes list only the reinvest
      // ISIN) so folio matching on scheme_nav.isin doesn't regress.
      isin: cols[1].trim() || cols[2].trim() || null,
      isinReinvest: cols[2].trim() || null,
      schemeName: [cols[3], col.plan != null ? cols[col.plan] : "", col.option != null ? cols[col.option] : ""]
        .map((s) => (s ?? "").trim())
        .filter(Boolean)
        .join(" - "),
      amcName: currentAmc,
      schemeType: currentType,
      schemeCategory: currentCategory,
      nav,
      navDate,
    });
  }
  return out;
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
 * Upsert NAV records into scheme_nav in batches. Returns the count written.
 * Uses withSystem (the table has no RLS, but withSystem is the consistent
 * cross-tenant maintenance entry point).
 */
export async function upsertNavs(records: NavRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  const BATCH = 500;
  let written = 0;

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    await withSystem(async (tx) => {
      // Build a single multi-row INSERT ... ON CONFLICT for the batch.
      const values = sql.join(
        batch.map(
          (r) =>
            sql`(${r.schemeCode}, ${r.isin}, ${r.isinReinvest}, ${r.schemeName}, ${r.amcName}, ${r.schemeType}, ${r.schemeCategory}, ${r.nav}, ${r.navDate}, now())`
        ),
        sql`, `
      );
      await tx.execute(sql`
        INSERT INTO scheme_nav (scheme_code, isin, isin_reinvest, scheme_name, amc_name, scheme_type, scheme_category, nav, nav_date, updated_at)
        VALUES ${values}
        ON CONFLICT (scheme_code) DO UPDATE SET
          isin = EXCLUDED.isin,
          isin_reinvest = EXCLUDED.isin_reinvest,
          scheme_name = EXCLUDED.scheme_name,
          amc_name = EXCLUDED.amc_name,
          scheme_type = COALESCE(EXCLUDED.scheme_type, scheme_nav.scheme_type),
          scheme_category = COALESCE(EXCLUDED.scheme_category, scheme_nav.scheme_category),
          nav = EXCLUDED.nav,
          nav_date = EXCLUDED.nav_date,
          updated_at = now()
      `);
    });
    written += batch.length;
  }
  return written;
}

/**
 * Minimum plausible scheme count in a healthy AMFI feed. The real feed carries
 * ~14k schemes; anything under this means the upstream format moved or the
 * download was truncated, NOT that India lost its mutual funds.
 */
export const NAV_FEED_MIN_RECORDS = Number(process.env.NAV_FEED_MIN_RECORDS ?? 1000);

/**
 * Full pipeline: fetch → parse → upsert. Returns a summary.
 *
 * THROWS when the parse yields implausibly few records. This is deliberate: in
 * Aug 2026 AMFI inserted two columns, the positional parser produced zero rows,
 * `upsertNavs([])` wrote nothing and returned 0, and the daily job logged a
 * cheerful "upserted 0 schemes" for 15 days while every tenant's AUM silently
 * froze at stale prices. A pipeline that writes nothing must fail loudly, not
 * succeed quietly — the caller's error path is what surfaces it.
 */
export async function refreshNav(): Promise<{
  fetched: number;
  written: number;
  navDate: string | null;
}> {
  const body = await fetchNavAll();
  const records = parseNavAll(body);

  if (records.length < NAV_FEED_MIN_RECORDS) {
    const header = body.split(/\r?\n/).find((l) => l.includes(";"))?.slice(0, 200) ?? "(no delimited line)";
    throw new Error(
      `AMFI feed parsed only ${records.length} records (expected >= ${NAV_FEED_MIN_RECORDS}). ` +
        `The upstream layout has probably changed — scheme_nav was NOT updated. First delimited line: ${header}`
    );
  }

  const written = await upsertNavs(records);
  // Most-common nav date across the feed (sanity field for logs).
  const navDate = records.length ? records[records.length - 1].navDate : null;
  return { fetched: records.length, written, navDate };
}
