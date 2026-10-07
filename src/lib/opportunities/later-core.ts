/**
 * "Later" — the client wants it, but not yet. The rules both sides share
 * (plain module: the dialog computes the same reminder date the server will).
 *
 *   revisit date   when the client said they would go ahead ("after Diwali",
 *                  "in three months", the day their FD matures).
 *   reminder       a task for the owner LEAD days before it — a week for
 *                  mutual funds, two for insurance (underwriting takes time) —
 *                  so the call comes while the money is still uncommitted.
 *   escalation     a reminder ESCALATE_AFTER_DAYS overdue goes to the
 *                  client's branch head as well.
 *   snooze limit   put off SNOOZE_LIMIT times, the card asks whether it is
 *                  really lost.
 *
 * The server side (park / resume / escalate) is later.ts.
 */

import type { OpportunityPipeline } from "./products";
import type { InflowSourceType } from "@/db/schema/expected_inflows";

export const REVISIT_LEAD_DAYS: Record<OpportunityPipeline, number> = { mf: 7, insurance: 15, general: 7 };
export const ESCALATE_AFTER_DAYS = 3;
export const SNOOZE_LIMIT = 3;

/**
 * Diwali (Lakshmi Puja) by year. "After Diwali" revisits five days on, once
 * Bhai Dooj is over; with the lead time the reminder lands before the
 * festival, when the conversation about festive money is natural.
 * Add a year here as the calendar rolls on — a year missing just hides the
 * preset, it never guesses.
 */
const DIWALI: Record<number, string> = {
  2026: "2026-11-08",
  2027: "2027-10-29",
  2028: "2028-10-17",
};

/** Today in India, and `n` days on — YYYY-MM-DD. */
export function istDay(n = 0): string {
  return new Date(Date.now() + 5.5 * 36e5 + n * 864e5).toISOString().slice(0, 10);
}

/** `day` moved by `n` days — YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  const want = d.getUTCMonth() + n;
  d.setUTCMonth(want);
  // 31 Jan + 1 month is 28 Feb, not 3 Mar.
  if (d.getUTCMonth() !== ((want % 12) + 12) % 12) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export type LaterPreset = { key: string; label: string; reason: string; day: string };

/** The quick picks, in the order a client says them. Only future dates. */
export function laterPresets(today = istDay()): LaterPreset[] {
  const out: LaterPreset[] = [];
  const year = Number(today.slice(0, 4));
  const diwali = [DIWALI[year], DIWALI[year + 1]].filter(Boolean).map((d) => addDays(d!, 5)).find((d) => d > today);
  if (diwali) out.push({ key: "diwali", label: "After Diwali", reason: "After Diwali", day: diwali });
  out.push({ key: "1m", label: "In a month", reason: "In a month", day: addMonths(today, 1) });
  out.push({ key: "3m", label: "In 3 months", reason: "In three months", day: addMonths(today, 3) });
  out.push({ key: "6m", label: "In 6 months", reason: "In six months", day: addMonths(today, 6) });
  const fy = `${today.slice(5) >= "04-01" ? year + 1 : year}-04-01`;
  out.push({ key: "fy", label: "New financial year", reason: "In the new financial year", day: fy });
  return out;
}

/** The day the owner's reminder falls due: LEAD days ahead, never before today. */
export function reminderDay(revisitOn: string, pipeline: OpportunityPipeline, today = istDay()): string {
  const d = addDays(revisitOn, -REVISIT_LEAD_DAYS[pipeline]);
  return d < today ? today : d;
}

/**
 * Where the money a client waits for comes from — the expected-inflow source
 * types, labelled for the "when money comes in" picker. A Record over the
 * schema's type, so a new source type fails to compile until it is named here.
 */
export const MONEY_SOURCE_LABELS: Record<InflowSourceType, string> = {
  fd_maturity: "FD maturity",
  insurance_maturity: "Insurance / LIC maturity",
  bonus: "Bonus",
  property_sale: "Property sale",
  gratuity: "Gratuity / retirement",
  esop: "ESOP / RSU",
  inheritance: "Inheritance",
  ppf_epf: "PPF / EPF maturity",
  rent: "Rent",
  business_income: "Business income",
  other: "Other money",
};
