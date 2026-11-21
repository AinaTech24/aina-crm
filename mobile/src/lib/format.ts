/**
 * Formatting helpers shared across screens. Indian number conventions (lakh /
 * crore) for money, since that's how MFDs read AUM/SIP.
 */

export function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Compact INR: ₹1.2Cr, ₹3.4L, ₹45,000, ₹0. */
export function inr(value: unknown): string {
  const n = toNumber(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  // toFixed(2) always yields ".dd", so stripping trailing zeros (and a bare
  // ".") is safe: 3.40 → 3.4, 1.00 → 1, 1.25 stays.
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2).replace(/\.?0+$/, "")}L`;
  if (abs >= 1000) return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
  return `${sign}₹${Math.round(abs)}`;
}

/** Full INR with grouping: ₹12,34,567. */
export function inrFull(value: unknown): string {
  return `₹${Math.round(toNumber(value)).toLocaleString("en-IN")}`;
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  // Letters/digits only per word, so "Rajesh Demo (Owner)" gives "RO", not "R(".
  // The range keeps Devanagari/Gujarati and other non-Latin scripts.
  const parts = name.trim().split(/\s+/).map((p) => p.replace(/[^A-Za-z0-9\u00C0-\uFFFF]/g, "")).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The firm works on India time (CLAUDE.md: "India dates"), whatever zone the phone is set to. */
export const IST = "Asia/Kolkata";

/**
 * A server date/time → Date, or null. Routes that use raw SQL hand back
 * Postgres' own text ("2026-11-20 03:30:00.123456+00") rather than ISO; normalise
 * it (T separator, ≤3 fraction digits, "+00" → "+00:00") so every JS engine
 * reads it the same. A bare "YYYY-MM-DD" stays a calendar date (UTC midnight,
 * which is the same day in India).
 */
export function parseDate(input?: string | number | Date | null): Date | null {
  if (input == null || input === "") return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === "number") { const d = new Date(input); return isNaN(d.getTime()) ? null : d; }
  const s = String(input).trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(s);
  let iso = s;
  if (m) {
    const [, day, time, frac, tz] = m;
    const zone = !tz ? "" : /^z$/i.test(tz) ? "Z" : tz.length === 3 ? `${tz}:00` : tz.includes(":") ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`;
    iso = `${day}T${time.length === 5 ? `${time}:00` : time}${frac ? `.${frac.slice(0, 3).padEnd(3, "0")}` : ""}${zone}`;
  }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** "12 Jun 2026" — stable, no locale surprises, India's calendar day. */
export function fmtDate(input?: string | number | Date | null): string {
  const d = parseDate(input);
  if (!d) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: IST });
}

/** "4:30 pm" in India time, or "" for no / bad input. */
export function fmtTime(input?: string | number | Date | null): string {
  const d = parseDate(input);
  if (!d) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST });
}

/** "12 Jun 2026, 4:30 pm" in India time. */
export function fmtDateTime(input?: string | number | Date | null): string {
  const d = parseDate(input);
  if (!d) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: IST });
}

/** "YYYY-MM" → "November 2026" (a calendar month, never shifted by a zone). */
export function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/** "3d ago", "2h ago", "just now". */
export function timeAgo(input?: string | number | null): string {
  const d = parseDate(input);
  if (!d) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(input);
}

/** Turn snake_case / enum values into "Title Case". */
export function titleCase(s?: string | null): string {
  if (!s) return "";
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
