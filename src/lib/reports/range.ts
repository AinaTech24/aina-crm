/**
 * The custom-report view's "Filter by" date range (?dateField=&from=&to=,
 * India dates, both ends inclusive). It narrows the saved filter for one run
 * only. The field must be a date / datetime field of the report's module.
 */
import { and, p, type FilterAST } from "@/lib/filter/ast";
import { getField } from "@/lib/filter/catalog";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10);

export function withDateRange(
  subject: string,
  ast: FilterAST | null,
  range: { field: string | null; from: string | null; to: string | null }
): FilterAST | null {
  const { field, from, to } = range;
  if (!field || (!from && !to)) return ast;
  const def = getField(subject, field);
  if (def.type !== "date" && def.type !== "datetime") throw Object.assign(new Error("not a date field"), { status: 400 });
  const preds: FilterAST[] = [];
  if (from && ISO.test(from)) preds.push(p(field, "gte", def.type === "date" ? from : `${from}T00:00:00+05:30`));
  if (to && ISO.test(to)) preds.push(def.type === "date" ? p(field, "lte", to) : p(field, "lt", `${nextDay(to)}T00:00:00+05:30`));
  if (!preds.length) return ast;
  return ast ? and(ast, ...preds) : and(...preds);
}
