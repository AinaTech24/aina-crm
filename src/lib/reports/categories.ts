/**
 * Category columns — Zoho's "number / picklist category columns" (2026-11-19).
 * A report may define up to two: a NUMBER field cut into bands (AUM: below
 * ₹10 L · ₹10 L–1 Cr · above ₹1 Cr; age: under 30 · 30–50 · 50+), or a
 * field's VALUES gathered into named groups (cities → regions). Each can then
 * be grouped by, pivoted on or shown as a column, as "cat:<id>".
 *
 * Safety: the SQL emits only a fixed two-digit code per bucket ("01" … "10",
 * "98" Other, "99" Not set) and the labels are applied in JS, so a label never
 * reaches SQL. Band bounds are inlined only after Number.isFinite; grouped
 * values are inlined as quoted literals with quotes doubled (standard SQL
 * strings), capped in count and length. Codes sort in band order.
 */

import { z } from "zod";
import { getField, type FieldType } from "@/lib/filter/catalog";

const NUMERIC: FieldType[] = ["number", "integer", "currency"];
export const MAX_CATEGORY_COLUMNS = 2;
export const MAX_BUCKETS = 10;

const band = z.object({
  label: z.string().trim().min(1).max(40),
  /** Inclusive lower bound; null = no lower bound. */
  min: z.number().finite().nullable().optional(),
  /** Exclusive upper bound; null = no upper bound. */
  max: z.number().finite().nullable().optional(),
});
const valueGroup = z.object({
  label: z.string().trim().min(1).max(40),
  values: z.array(z.string().max(80)).min(1).max(20),
});

export const categoryColumnSchema = z.object({
  id: z.string().regex(/^c[0-9]{1,2}$/),
  label: z.string().trim().min(1).max(60),
  source: z.string().max(60),
  kind: z.enum(["number", "values"]),
  bands: z.array(band).max(MAX_BUCKETS).optional(),
  groups: z.array(valueGroup).max(MAX_BUCKETS).optional(),
  /** What a value in no bucket reads as. */
  other: z.string().trim().max(40).optional(),
  /** What a blank value reads as. */
  empty: z.string().trim().max(40).optional(),
});
export const categoryColumnsSchema = z.array(categoryColumnSchema).max(MAX_CATEGORY_COLUMNS);
export type CategoryColumn = z.infer<typeof categoryColumnSchema>;

export const OTHER_CODE = "98";
export const EMPTY_CODE = "99";
const code = (i: number) => String(i + 1).padStart(2, "0");
const lit = (s: string) => `'${s.replace(/\0/g, "").replace(/'/g, "''")}'`;

export function isCategoryKey(key: string): boolean {
  return key.startsWith("cat:");
}

export function findCategory(categories: CategoryColumn[] | null | undefined, key: string): CategoryColumn {
  const id = key.slice(4);
  const c = (categories ?? []).find((x) => x.id === id);
  if (!c) throw new Error(`unknown field: category column "${id}" is not defined on this report`);
  return c;
}

/** The CASE expression for a category column, and how each code reads. */
export function categorySql(subject: string, c: CategoryColumn): { sql: string; labelOf: (code: string) => string } {
  const src = getField(subject, c.source);
  const other = c.other?.trim() || "Other";
  const empty = c.empty?.trim() || "Not set";
  const labels = new Map<string, string>([
    [OTHER_CODE, other],
    [EMPTY_CODE, empty],
  ]);
  const whens: string[] = [];
  if (c.kind === "number") {
    if (!NUMERIC.includes(src.type)) throw new Error(`${src.label} is not a number, so it cannot be banded`);
    const v = `(${src.sql})::numeric`;
    (c.bands ?? []).slice(0, MAX_BUCKETS).forEach((b, i) => {
      const conds: string[] = [];
      if (b.min != null && Number.isFinite(b.min)) conds.push(`${v} >= ${Number(b.min)}`);
      if (b.max != null && Number.isFinite(b.max)) conds.push(`${v} < ${Number(b.max)}`);
      whens.push(`WHEN ${conds.length ? conds.join(" AND ") : "TRUE"} THEN '${code(i)}'`);
      labels.set(code(i), b.label);
    });
    return {
      sql: `CASE WHEN (${src.sql}) IS NULL THEN '${EMPTY_CODE}' ${whens.join(" ")} ELSE '${OTHER_CODE}' END`,
      labelOf: (k) => labels.get(k) ?? k,
    };
  }
  const t = `(${src.sql})::text`;
  (c.groups ?? []).slice(0, MAX_BUCKETS).forEach((g, i) => {
    const vals = g.values.slice(0, 20).map((x) => lit(x));
    whens.push(`WHEN ${t} IN (${vals.join(", ")}) THEN '${code(i)}'`);
    labels.set(code(i), g.label);
  });
  return {
    sql: `CASE WHEN (${src.sql}) IS NULL OR ${t} = '' THEN '${EMPTY_CODE}' ${whens.join(" ")} ELSE '${OTHER_CODE}' END`,
    labelOf: (k) => labels.get(k) ?? k,
  };
}

/** Catch a definition the SQL builder would reject, before it is saved. */
export function assertValidCategories(subject: string, categories: CategoryColumn[] | null | undefined): void {
  const seen = new Set<string>();
  for (const c of categories ?? []) {
    if (seen.has(c.id)) throw new Error(`category column "${c.id}" is defined twice`);
    seen.add(c.id);
    if (c.kind === "number" && !(c.bands?.length)) throw new Error(`${c.label}: add at least one band`);
    if (c.kind === "values" && !(c.groups?.length)) throw new Error(`${c.label}: add at least one group`);
    categorySql(subject, c);
  }
}
