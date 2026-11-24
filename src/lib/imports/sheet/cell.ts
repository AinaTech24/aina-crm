/**
 * One spreadsheet cell → text. Pure, so it is tested without the spreadsheet library.
 *
 * Excel keeps a date as a number and only the CELL FORMAT says it is a date; read
 * naively, 24-11-2026 arrives as 46350. Here a number in a date format becomes ISO
 * text (2026-11-24, or 2026-11-24T14:30 when it has a time, or 14:30 for a bare
 * time) with no time-zone arithmetic, so a file reads the same on any computer.
 */

export type RawCell = { t?: string; v?: unknown; w?: string; z?: string | number } | undefined | null;

const pad = (n: number) => String(n).padStart(2, "0");

/** Is this number format a date / time? (Quoted text and [colour] / [$currency] parts do not count.) */
export function isDateFormat(z: unknown): boolean {
  if (typeof z !== "string" || !z) return false;
  const stripped = z.replace(/"[^"]*"/g, "").replace(/\[(?![hms]+\])[^\]]*\]/gi, "").replace(/\\./g, "");
  return /[dmyhs]/i.test(stripped) && !/^general$/i.test(stripped.trim());
}

/** An Excel serial day (1900 system) → ISO text. */
export function serialToIso(serial: number): string {
  const day = Math.floor(serial);
  let secs = Math.round((serial - day) * 86400);
  let d = day;
  if (secs >= 86400) { secs -= 86400; d += 1; }
  const t = new Date(Date.UTC(1899, 11, 30) + d * 86_400_000);
  const hh = Math.floor(secs / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const time = `${pad(hh)}:${pad(mm)}`;
  if (day === 0) return time; // a bare time
  const date = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  return secs === 0 ? date : `${date}T${time}`;
}

export function cellText(cell: RawCell): string {
  if (!cell) return "";
  const { t, v } = cell;
  if (v === undefined || v === null) return "";
  if (t === "e" || t === "z") return "";
  if (t === "b") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) {
    const d = v;
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return d.getUTCHours() || d.getUTCMinutes() ? `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
  }
  if (t === "n" || typeof v === "number") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    if (isDateFormat(cell.z) && n >= 0 && n < 100000) return serialToIso(n);
    return Number.isInteger(n) ? String(n) : String(+n.toFixed(10));
  }
  return String(v).replace(/ /g, " ").trim();
}
