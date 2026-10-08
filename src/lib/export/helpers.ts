/**
 * Small SQL helpers for export definitions: date formatting (India time) and
 * the common list filters (search box, status, date range) read from a list
 * page's URL.
 */

import { sql, type SQL } from "drizzle-orm";

/** A DATE column as yyyy-mm-dd text (Excel reads it as a date). */
export const d = (expr: SQL) => sql`to_char(${expr}, 'YYYY-MM-DD')`;

/** A TIMESTAMPTZ column as India date-time text. */
export const dt = (expr: SQL) => sql`to_char((${expr}) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`;

/** A TIMESTAMPTZ column as its India date. */
export const dIst = (expr: SQL) => sql`to_char((${expr}) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;

/** "a, b" from a text[] / jsonb array, empty when none. */
export const joinArr = (expr: SQL) => sql`array_to_string(${expr}, ', ')`;

/** A user's name by id. */
export const userName = (idExpr: SQL) => sql`(SELECT u_.name FROM users u_ WHERE u_.id = ${idExpr})`;

/** The search box: every word must appear in one of the columns. */
export function searchFilter(q: string | null, cols: SQL[]): SQL[] {
  const words = (q ?? "").trim().replace(/[%_]/g, " ").split(/\s+/).filter(Boolean).slice(0, 6);
  return words.map((w) => sql`(${sql.join(cols.map((c) => sql`COALESCE(${c}::text, '') ILIKE ${`%${w}%`}`), sql` OR `)})`);
}

/** `?status=a,b` → col IN (...), ignoring "all" / empty. */
export function inFilter(raw: string | null, col: SQL): SQL[] {
  const vals = (raw ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "all");
  if (!vals.length) return [];
  return [sql`${col}::text IN (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** `?from=&to=` (India dates) on a date or timestamptz column. */
export function dateRange(from: string | null, to: string | null, col: SQL, isTimestamp = false): SQL[] {
  const day = isTimestamp ? sql`((${col}) AT TIME ZONE 'Asia/Kolkata')::date` : sql`(${col})::date`;
  const out: SQL[] = [];
  if (from && DAY.test(from)) out.push(sql`${day} >= ${from}::date`);
  if (to && DAY.test(to)) out.push(sql`${day} <= ${to}::date`);
  return out;
}

/** A uuid param (?rm=, ?owner=) → col = it, ignoring junk. */
export function uuidEq(raw: string | null, col: SQL): SQL[] {
  return raw && /^[0-9a-f-]{36}$/i.test(raw) ? [sql`${col} = ${raw}::uuid`] : [];
}
