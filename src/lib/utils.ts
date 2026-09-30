import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  formatMoney,
  formatMoneyFull,
  formatDate as formatDateBase,
  formatRelative as formatRelativeBase,
  type DateStyle,
} from "@/lib/format";

export * from "@/lib/format";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Money and dates now live in `@/lib/format`, which is the single definition of
 * how a figure or a date looks in this product. These four names are kept
 * because 670 call sites import `formatINR` and 137 import `formatDate` from
 * here — they delegate, so those sites are already on the unified rules and
 * render exactly as before.
 *
 * New code should import from `@/lib/format` directly, and reach for
 * `pickMoneyScale()` whenever several figures sit in one row.
 */

/** Every digit: `₹32,00,000`. Right for a table read a row at a time. */
export function formatINR(amount: number | string | null | undefined): string {
  return formatMoneyFull(amount);
}

/** Indian-notation short money: `₹12.39 Cr` · `₹71.35 Lakh` · `₹3,000`. */
export function formatINRShort(amount: number | string | null | undefined): string {
  return formatMoney(amount);
}

/**
 * Reduce a raw phone string to its national 10-digit Indian mobile, or null if
 * it doesn't look like one. Tolerates +91 / 91 / leading-0 prefixes and any
 * spacing/punctuation. Used for display formatting + validity flagging.
 */
export function indianMobile10(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  // A valid Indian mobile is exactly 10 digits starting 6–9.
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** True when the value parses to a plausible Indian mobile number. */
export function isValidIndianMobile(raw: string | null | undefined): boolean {
  return indianMobile10(raw) != null;
}

/**
 * Human-friendly phone display. A valid Indian mobile renders as
 * "+91 98765 43210"; anything else is returned trimmed as-is so we never hide
 * what was actually stored (the caller can flag it invalid separately).
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = indianMobile10(raw);
  if (m) return `+91 ${m.slice(0, 5)} ${m.slice(5)}`;
  return String(raw).trim();
}

/** `7 Sept 2026`. Pass a `DateStyle` for the other shapes. */
export function formatDate(d: Date | string | number | null | undefined, style?: DateStyle): string {
  return formatDateBase(d, style);
}

export function formatRelative(d: Date | string | null | undefined): string {
  return formatRelativeBase(d);
}
