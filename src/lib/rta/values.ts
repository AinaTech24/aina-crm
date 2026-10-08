/**
 * Strict value readers for RTA files — numbers, dates, PANs.
 *
 * Every reader returns either a value or a REASON, never a guess. The importers
 * used to fall back silently: `parseFloat("1,23,456.78")` is 1, a blank or
 * unreadable date became today, "(1,000.00)" became 0, and any non-empty text
 * in a PAN column became a PAN. Each of those wrote a plausible-looking wrong
 * figure with no error. A row whose value cannot be read is now an error on
 * that row, so it is counted and shown instead of being stored wrong.
 *
 * Pure module: no database, no xlsx, no timezone. Dates are calendar strings
 * (YYYY-MM-DD) built from their components, so the server's TZ cannot shift
 * them.
 */

export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

const ok = <T,>(value: T): Read<T> => ({ ok: true, value });
const bad = <T,>(reason: string): Read<T> => ({ ok: false, reason });

// ── Numbers ─────────────────────────────────────────────────────────────────

/**
 * Digits with optional thousands separators, in either grouping:
 *   Indian   1,23,45,678.90   (one group of 3, then groups of 2)
 *   Western  12,345,678.90    (groups of 3)
 * A comma anywhere else ("12,34" — a decimal comma, or a typo) is rejected
 * rather than stripped, because stripping it changes the value 100-fold.
 */
const GROUPED = /^(?:\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
const PLAIN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Read an amount / units / NAV cell.
 *
 * Accepted: plain numbers (as a spreadsheet cell stringifies them, including
 * exponent form), Indian or Western thousands grouping, a leading "+" / "-",
 * a leading "₹" / "Rs" / "Rs.", and accounting parentheses "(1,000.00)" for a
 * negative. Rejected with a reason: trailing minus, CR / DR suffixes, decimal
 * commas, more than one sign, and anything else — those notations exist in
 * some exports, but what they mean in a registrar file is not documented here,
 * so they are not interpreted.
 *
 * Blank → `{ ok: true, value: null }`: missing is not zero. The caller decides
 * whether the field is mandatory.
 */
export function readNumber(raw: string | null | undefined): Read<number | null> {
  let s = (raw ?? "").trim();
  if (!s) return ok(null);
  const original = s;

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-") || s.startsWith("+")) {
    if (negative) return bad(`"${original}" carries two signs`);
    negative = s.startsWith("-");
    s = s.slice(1).trim();
  }
  s = s.replace(/^(?:₹|rs\.?|inr)\s*/i, "");
  if (s.startsWith("-") || s.startsWith("+")) return bad(`"${original}" is not a number this importer reads`);

  if (GROUPED.test(s)) s = s.replace(/,/g, "");
  else if (s.includes(",")) return bad(`"${original}" has a comma that is not a thousands separator`);
  if (!PLAIN.test(s)) return bad(`"${original}" is not a number this importer reads`);

  const n = Number(s);
  if (!Number.isFinite(n)) return bad(`"${original}" is not a finite number`);
  return ok(negative && n !== 0 ? -n : n);
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** Which way round a file writes numeric dates: day first or month first. */
export type DateOrder = "dmy" | "mdy";

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** A real calendar date in a sane window, as YYYY-MM-DD — else null. */
export function isoFromParts(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Optional time after a date: "12:00 AM", "00:00:00", "T10:15:00Z" …
const TIME = String.raw`(?:[ T]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AP]M)?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const RE_ISO = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME}$`, "i");
const RE_YMD = /^(\d{4})(\d{2})(\d{2})$/;
const RE_NUM = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})${TIME}$`, "i");
const RE_MON = new RegExp(String.raw`^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ,]+(\d{4})${TIME}$`, "i");

/**
 * Read a date cell into YYYY-MM-DD.
 *
 * Accepted: ISO (YYYY-MM-DD, what the spreadsheet decoder emits for a date
 * cell), bare YYYYMMDD (a dBASE date field), D/M/YYYY, D-M-YYYY or D.M.YYYY
 * (or M/D/YYYY when `order` is "mdy" — decided once per file, see
 * detectDateOrder), and D-MON-YYYY with a month name. A trailing clock time is
 * ignored. Every result is checked against the calendar, so 31/02/2024 is an
 * error, not 2024-02-31.
 *
 * Rejected with a reason: two-digit years ("15-OCT-24" — the century is a
 * guess), bare numbers (an Excel serial that reached us as text: whether it is
 * a date at all depends on the column, so the caller converts it with
 * excelSerialToIso when it knows), and anything else.
 *
 * Blank → `{ ok: true, value: null }`. A missing date is never replaced with
 * today: the caller rejects the row when the date is mandatory.
 */
export function readDate(raw: string | null | undefined, order: DateOrder = "dmy"): Read<string | null> {
  const s = (raw ?? "").trim();
  if (!s) return ok(null);
  let m: RegExpMatchArray | null;

  if ((m = s.match(RE_ISO))) {
    const iso = isoFromParts(+m[1], +m[2], +m[3]);
    return iso ? ok(iso) : bad(`"${s}" is not a real calendar date`);
  }
  if ((m = s.match(RE_YMD))) {
    const iso = isoFromParts(+m[1], +m[2], +m[3]);
    return iso ? ok(iso) : bad(`"${s}" is not a real calendar date`);
  }
  if ((m = s.match(RE_NUM))) {
    const a = +m[1], b = +m[2], y = +m[3];
    const [d, mo] = order === "mdy" ? [b, a] : [a, b];
    if (mo > 12) {
      return bad(`"${s}" does not fit this file's date order (${order === "mdy" ? "month first" : "day first"})`);
    }
    const iso = isoFromParts(y, mo, d);
    return iso ? ok(iso) : bad(`"${s}" is not a real calendar date`);
  }
  if ((m = s.match(RE_MON))) {
    const mo = MONTHS[m[2].toUpperCase()] ?? MONTHS[m[2].slice(0, 3).toUpperCase()];
    if (!mo) return bad(`"${s}" has an unknown month name`);
    const iso = isoFromParts(+m[3], mo, +m[1]);
    return iso ? ok(iso) : bad(`"${s}" is not a real calendar date`);
  }
  if (/^\d{1,2}[-/. ](?:\d{1,2}|[A-Za-z]{3,9})[-/. ]\d{2}$/.test(s)) {
    return bad(`"${s}" has a two-digit year — the century cannot be read safely`);
  }
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    return bad(`"${s}" is a bare number, not a date`);
  }
  return bad(`"${s}" is not a date this importer reads`);
}

/**
 * Infer a file's numeric date order from its date column. A first component
 * above 12 can only be a day; a second above 12 can only be a day too. If
 * nothing disambiguates, the Indian day-first default stands.
 *
 * Returns "conflict" when the column contains BOTH shapes — a file written two
 * ways cannot be read safely either way, and every ambiguous row in it would be
 * a coin flip.
 */
export function detectDateOrder(samples: Iterable<string | null | undefined>): DateOrder | "conflict" {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const raw of samples) {
    const m = (raw ?? "").trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}/);
    if (!m) continue;
    if (+m[1] > 12) dayFirst++;
    if (+m[2] > 12) monthFirst++;
  }
  if (dayFirst > 0 && monthFirst > 0) return "conflict";
  return monthFirst > 0 ? "mdy" : "dmy";
}

/**
 * Excel serial day number → YYYY-MM-DD, by pure arithmetic (no Date in local
 * time, so no timezone can move it). `date1904` is the workbook's 1904 date
 * system (old Mac Excel). Serials before 61 fall in Excel's fictitious
 * 29-Feb-1900 range and are refused.
 */
export function excelSerialToIso(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial)) return null;
  const day = Math.floor(serial);
  if (!date1904 && day < 61) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + day * 86_400_000);
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// ── PAN ─────────────────────────────────────────────────────────────────────

/**
 * PAN shape: five letters, four digits, one letter, where the FOURTH letter is
 * the holder type the Income Tax Department assigns — P individual, C company,
 * H HUF, F firm / LLP, A association of persons, T trust, B body of
 * individuals, L local authority, J artificial juridical person, G government.
 * Placeholder text such as "NA", "PANEXEMPT", "XXXXXXXXXX" or "ABCDE1234F"
 * fails it and is treated as NO PAN, so it can never become a matching key.
 */
const PAN_RE = /^[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]$/;

/** The PAN, upper-cased and trimmed, if it is a valid PAN — else null. */
export function validPan(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toUpperCase();
  return PAN_RE.test(v) ? v : null;
}

/** ABCPE1234F → ABC••••4F. Anything that is not PAN-shaped is returned masked whole. */
export function maskPanValue(raw: string): string {
  const v = raw.trim();
  return v.length >= 6 ? `${v.slice(0, 3)}••••${v.slice(-2)}` : "••••";
}

/**
 * Mask every PAN-shaped token in a free-text message. Import errors are shown
 * to staff and stored; they must never carry a full PAN. Applied on write AND
 * on read, so messages stored before this existed are masked too.
 */
export function maskPansInText(text: string): string {
  return text.replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi, (p) => maskPanValue(p));
}

/** A registrar's free-text reason, safe to keep: PANs and every digit run masked, length capped. */
export function rejectionReasonText(raw: string): string | undefined {
  const t = (raw ?? "").replace(/[A-Za-z]{5}[0-9]{4}[A-Za-z]/g, "<pan>").replace(/[0-9]+/g, "#").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 160) : undefined;
}
