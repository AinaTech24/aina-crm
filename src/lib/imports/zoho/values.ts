/**
 * Cell readers for a Zoho CRM export (Contacts / Meetings), pure and tested
 * (tests/zoho-import.test.ts).
 *
 * A Zoho export reaches us either as Zoho's own .xlsx/.csv or after someone
 * opened it in Excel, so every reader accepts both shapes: text in the export
 * user's format ("15/03/2024 10:30 AM", "2024-03-15 10:30:00",
 * "Mar 15, 2024 10:30 AM") or an Excel serial number. Zoho writes date-times
 * in the exporting user's time zone; for an Indian firm that is IST, so a
 * wall-clock time is read as Asia/Kolkata — never as the server's zone
 * (production runs UTC).
 */

const IST_OFFSET_MIN = 330;

/** Trimmed text of a cell; null / undefined / "" → "". */
export function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v).trim();
}

/**
 * A Zoho record id as one comparable key. Zoho exports write ids as
 * "zcrm_5725767000000412001"; the API and some exports drop the prefix.
 * Returns "" for a blank cell.
 */
export function zohoId(v: unknown): string {
  const s = cell(v).replace(/^zcrm_/i, "").replace(/\s+/g, "");
  return s;
}

/**
 * Excel turns a 19-digit id into 5.72577E+18 the moment the CSV is opened and
 * saved — the digits are gone and no two records can be told apart. Such a cell
 * arrives as a NUMBER (or its scientific text). Detect it so the import refuses
 * the file instead of linking meetings to the wrong clients.
 */
export function idDamagedByExcel(v: unknown): boolean {
  if (typeof v === "number") return Math.abs(v) >= 1e15;
  return /^\d(\.\d+)?e\+\d+$/i.test(cell(v));
}

/** Yes / No style cell → true / false; anything unreadable → null. */
export function yesNo(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = cell(v).toLowerCase();
  if (!s) return null;
  if (["yes", "y", "true", "1", "done", "active", "held", "ok"].includes(s)) return true;
  if (["no", "n", "false", "0", "-", "na", "n/a", "nil", "none"].includes(s)) return false;
  return null;
}

/** An Indian mobile as 10 digits where it clearly is one; other numbers as typed digits. */
export function mobile(v: unknown): string {
  let d = cell(v).replace(/\.0+$/, "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

export function pan(v: unknown): string {
  const s = cell(v).toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s) ? s : "";
}

export function email(v: unknown): string {
  const s = cell(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

type WallClock = { y: number; m: number; d: number; hh: number; mi: number; hasTime: boolean };

function validDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function to24(hh: number, ampm: string | undefined): number {
  if (!ampm) return hh;
  const pm = ampm.toLowerCase() === "pm";
  if (hh === 12) return pm ? 12 : 0;
  return pm ? hh + 12 : hh;
}

/** Read a date / date-time cell as wall-clock parts, or null. Day-first for d/m/y. */
export function wallClock(v: unknown): WallClock | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // A Date built by a spreadsheet library carries the wall clock in UTC parts.
    return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate(), hh: v.getUTCHours(), mi: v.getUTCMinutes(), hasTime: v.getUTCHours() + v.getUTCMinutes() > 0 };
  }
  if (typeof v === "number" || /^\d{4,5}(\.\d+)?$/.test(cell(v))) {
    const serial = Number(v);
    if (!(serial > 0 && serial < 100000)) return null;
    const ms = Math.round(serial * 86_400_000);
    const t = new Date(Date.UTC(1899, 11, 30) + ms);
    const frac = serial % 1;
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mi: t.getUTCMinutes(), hasTime: frac > 0 };
  }
  const s = cell(v).replace(/\s+/g, " ");
  if (!s) return null;

  const time = /(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([AaPp][Mm])?)?\s*(?:Z|[+-]\d{2}:?\d{2}|IST)?$/;
  let m: RegExpMatchArray | null;

  // 2024-03-15[ 10:30[:00]]
  m = s.match(new RegExp(/^(\d{4})-(\d{1,2})-(\d{1,2})/.source + time.source));
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (!validDate(y, mo, d)) return null;
    return { y, m: mo, d, hh: m[4] ? to24(+m[4], m[7]) : 0, mi: m[5] ? +m[5] : 0, hasTime: !!m[4] };
  }
  // 15/03/2024, 15-03-2024, 15.03.24 (day first; a "month" over 12 means it was m/d)
  m = s.match(new RegExp(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.source + time.source));
  if (m) {
    let [d, mo, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (!validDate(y, mo, d)) return null;
    return { y, m: mo, d, hh: m[4] ? to24(+m[4], m[7]) : 0, mi: m[5] ? +m[5] : 0, hasTime: !!m[4] };
  }
  // 15-Mar-2024 / 15 Mar 2024
  m = s.match(new RegExp(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ ,-]*(\d{2,4})/.source + time.source));
  const monthOf = (word: string) => MONTHS[word.slice(0, 4).toLowerCase()] ?? MONTHS[word.slice(0, 3).toLowerCase()];
  if (m && monthOf(m[2])) {
    const mo = monthOf(m[2]);
    let y = +m[3];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const d = +m[1];
    if (!validDate(y, mo, d)) return null;
    return { y, m: mo, d, hh: m[4] ? to24(+m[4], m[7]) : 0, mi: m[5] ? +m[5] : 0, hasTime: !!m[4] };
  }
  // Mar 15, 2024 10:30 AM
  m = s.match(new RegExp(/^([A-Za-z]{3,9})[ .]+(\d{1,2}),?[ ]+(\d{4})/.source + time.source));
  if (m) {
    const mo = monthOf(m[1]);
    const [d, y] = [+m[2], +m[3]];
    if (!mo || !validDate(y, mo, d)) return null;
    return { y, m: mo, d, hh: m[4] ? to24(+m[4], m[7]) : 0, mi: m[5] ? +m[5] : 0, hasTime: !!m[4] };
  }
  return null;
}

/** A calendar date cell → "YYYY-MM-DD", or null. */
export function isoDate(v: unknown): string | null {
  const w = wallClock(v);
  if (!w) return null;
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/** A calendar date as the instant midnight IST — how the CRM stores date-only timestamps from an Indian firm. */
export function istMidnight(v: unknown): Date | null {
  const iso = isoDate(v);
  return iso ? new Date(`${iso}T00:00:00+05:30`) : null;
}

/** A date-time cell read as Indian wall-clock time → the instant. Null when unreadable. */
export function istInstant(v: unknown): Date | null {
  const w = wallClock(v);
  if (!w) return null;
  return new Date(Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mi) - IST_OFFSET_MIN * 60_000);
}

/** Does the cell carry a time of day (not just a date)? */
export function hasTime(v: unknown): boolean {
  return wallClock(v)?.hasTime ?? false;
}

/** Normalise a person's name for matching: lower case, single spaces, no dots. */
export function nameKey(v: unknown): string {
  return cell(v).toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ").trim();
}

/** Age in whole years on `now` for a YYYY-MM-DD date of birth. */
export function ageOn(dobIso: string, now: Date): number {
  const [y, m, d] = dobIso.split("-").map(Number);
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  let age = ist.getUTCFullYear() - y;
  const md = (ist.getUTCMonth() + 1) * 100 + ist.getUTCDate();
  if (md < m * 100 + d) age--;
  return age;
}
