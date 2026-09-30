/**
 * Small display helpers for the Control Tower — a plain module, so server
 * sections and client components share one set (a server component cannot
 * call a function exported from a "use client" file).
 *
 * Dates go through formatDate (@/lib/format): India time, "Sep" not "Sept".
 */

import { formatDate } from "@/lib/format";

/** Hours as the operations team reads them: "5.2 h" up to a day, then days. */
export function fmtHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  const d = h / 24;
  return `${d.toFixed(d < 10 ? 1 : 0)} days`;
}

export function fmtDays(d: number | null | undefined): string {
  if (d == null) return "—";
  if (d <= 0) return "Today";
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** Date and time in India time: "28 Sep 2026, 10:45 AM". */
export function fmtIstDateTime(iso: string | null | undefined): string {
  return formatDate(iso, "dateTime");
}

/** Short date in India time: "28 Sep". A bare yyyy-mm-dd is read as that calendar day. */
export function fmtIstDay(iso: string | null | undefined): string {
  return formatDate(iso, "dayMonth");
}

/** Status → the brief's colour rule (green done · blue in process · amber waiting · grey not started / N/A). */
export const STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral"> = {
  completed: "success",
  in_progress: "info",
  blocked: "warning",
  awaiting_approval: "warning",
  open: "neutral",
  cancelled: "neutral",
};

export const SLA_TONE: Record<string, "danger" | "warning" | "neutral"> = {
  breached: "danger",
  approaching: "warning",
  within: "neutral",
  none: "neutral",
};
export const SLA_LABEL: Record<string, string> = {
  breached: "Breached",
  approaching: "Due soon",
  within: "Within SLA",
  none: "No SLA",
};

const RELATIVE = ["today", "yesterday", "this week", "previous week", "last week", "this month", "this quarter"];

/** A period label that reads inside a sentence: "today", "this week", "in September 2026". */
export function inPeriod(label: string): string {
  const l = label.trim();
  return RELATIVE.includes(l.toLowerCase()) ? l.toLowerCase() : `in ${l}`;
}

/** The label as a noun in running text: "today", "September 2026". */
export function periodNoun(label: string): string {
  const l = label.trim();
  return RELATIVE.includes(l.toLowerCase()) ? l.toLowerCase() : l;
}

/** Compact India-time stamp for dense tables: "26 Sep, 11:15 AM". */
export function fmtIstShort(iso: string | null | undefined): string {
  const day = formatDate(iso, "dayMonth");
  return day === "—" ? day : `${day}, ${formatDate(iso, "time")}`;
}
