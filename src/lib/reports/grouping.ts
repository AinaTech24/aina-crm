/**
 * What a custom report can group by: any catalog field, or a DATE field
 * bucketed by day / week / month / FY quarter / FY / calendar year — Zoho's
 * "group dates by month and year" (2026-11-19). A bucketed field is stored
 * as "<field>@<grain>" (e.g. "onboarded_at@month") wherever a group-by or
 * pivot key goes, so saved reports need no new column.
 *
 * Buckets are computed in India time and their keys sort in date order as
 * plain text ("2026-04", "FY 2026-27 Q1"), so ORDER BY and the matrix's
 * column sort need nothing special; `groupKeyLabel` turns a key into what the
 * page shows ("Apr 2026"). Pure and client-safe.
 */

import { getField, type FieldType } from "@/lib/filter/catalog";
import { categorySql, findCategory, isCategoryKey, type CategoryColumn } from "./categories";

export const DATE_GRAINS = ["day", "week", "month", "quarter", "fy", "year"] as const;
export type DateGrain = (typeof DATE_GRAINS)[number];

export const DATE_GRAIN_LABEL: Record<DateGrain, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter (Apr–Jun = Q1)",
  fy: "Financial year",
  year: "Calendar year",
};

export type GroupField = {
  key: string;
  label: string;
  sql: string;
  type: FieldType;
  grain: DateGrain | null;
  /** How a value of this group reads ("2026-04" → "Apr 2026"; a band code → its label). */
  labelOf: (value: string) => string;
};
const asIs = (v: string) => v;

const isDateType = (t: FieldType) => t === "date" || t === "datetime";

export function isDateGrain(v: unknown): v is DateGrain {
  return typeof v === "string" && (DATE_GRAINS as readonly string[]).includes(v);
}

/** Split "onboarded_at@month" into its field and grain. */
export function splitGroupKey(key: string): { field: string; grain: DateGrain | null } {
  const at = key.indexOf("@");
  if (at < 0) return { field: key, grain: null };
  const grain = key.slice(at + 1);
  return { field: key.slice(0, at), grain: isDateGrain(grain) ? grain : null };
}

/**
 * Resolve a group-by / pivot key to its SQL: a catalog field, a bucketed date
 * ("<field>@<grain>") or one of the report's category columns ("cat:<id>").
 * Throws on an unknown field, an unknown grain, a grain on a field that is not
 * a date, or an undefined category — the same "no injection, no broken
 * report" guarantee as `getField`.
 */
export function groupField(subject: string, key: string, categories?: CategoryColumn[] | null): GroupField {
  if (isCategoryKey(key)) {
    const c = findCategory(categories, key);
    const { sql, labelOf } = categorySql(subject, c);
    return { key, label: c.label, sql, type: "string", grain: null, labelOf };
  }
  const at = key.indexOf("@");
  const def = getField(subject, at < 0 ? key : key.slice(0, at));
  if (at < 0) return { key, label: def.label, sql: def.sql, type: def.type, grain: null, labelOf: asIs };
  const grain = key.slice(at + 1);
  if (!isDateGrain(grain)) throw new Error(`unknown date grouping "${grain}"`);
  if (!isDateType(def.type)) throw new Error(`${def.label} is not a date, so it cannot be grouped by ${DATE_GRAIN_LABEL[grain].toLowerCase()}`);
  // India wall-clock time of the value (a date column reads as its own day).
  const local = `((${def.sql})::timestamptz AT TIME ZONE 'Asia/Kolkata')`;
  // The Indian FY starts in April: shift back three months and the calendar
  // year / quarter of the result are the FY's start year / quarter.
  const fyStartYear = `EXTRACT(YEAR FROM ${local} - interval '3 months')::int`;
  const fyName = `'FY ' || ${fyStartYear} || '-' || lpad(((${fyStartYear} + 1) % 100)::text, 2, '0')`;
  const sql: Record<DateGrain, string> = {
    day: `to_char(${local}, 'YYYY-MM-DD')`,
    week: `to_char(date_trunc('week', ${local}), 'YYYY-MM-DD')`,
    month: `to_char(${local}, 'YYYY-MM')`,
    quarter: `${fyName} || ' Q' || EXTRACT(QUARTER FROM ${local} - interval '3 months')::int`,
    fy: fyName,
    year: `to_char(${local}, 'YYYY')`,
  };
  return { key, label: `${def.label} (by ${grainNoun(grain)})`, sql: sql[grain], type: "string", grain, labelOf: (v) => groupKeyLabel(grain, v) };
}

function grainNoun(g: DateGrain): string {
  return g === "fy" ? "financial year" : g === "quarter" ? "quarter" : g === "year" ? "year" : g;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** What a bucket key reads as on the page: "2026-04" → "Apr 2026". */
export function groupKeyLabel(grain: DateGrain | null | undefined, key: string): string {
  if (!grain || key === "—") return key;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(key);
  if (grain === "month" && m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  if (grain === "day" && m && m[3]) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  if (grain === "week" && m && m[3]) return `Week of ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return key;
}

/** The grain of a group / pivot key, for labelling results. */
export function grainOf(key: string | null | undefined): DateGrain | null {
  return key ? splitGroupKey(key).grain : null;
}
