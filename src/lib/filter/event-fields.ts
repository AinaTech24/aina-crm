import type { FieldDef } from "./catalog";
import { getField } from "./catalog";
import type { FilterAST } from "./ast";

/** Runtime-only fields. Never passed to the SQL compiler. */
const eventTypes: Record<string, FieldDef["type"]> = {
  reason_code: "string", sub_reason: "string", amount: "number", days_to_expiry: "number",
  scheme_name: "string", order_date: "date", kind: "string", entity_id: "uuid",
  nifty_change_pct: "number", risk_category: "string", priority: "string",
};
export function getRuntimeField(subject: string, key: string): FieldDef {
  if (key.startsWith("event.")) {
    const name = key.replace(/^event\.(?:after\.|meta\.)?/, "");
    const type = eventTypes[name];
    if (!type) throw new Error(`Unknown event field '${key}'`);
    return { key, label: key, type, sql: "", ops: type === "number"
      ? ["eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "is_null", "is_not_null"]
      : ["eq", "ne", "in", "not_in", "contains", "is_empty", "is_not_empty", "is_null", "is_not_null"] };
  }
  return getField(subject, key.replace(/^subject\./, ""));
}
export function validateRuntimeFilter(ast: FilterAST, subject: string): void {
  if ("children" in ast) { ast.children.forEach((child) => validateRuntimeFilter(child, subject)); return; }
  if (ast.field.kind === "rel") { validateRuntimeFilter(ast.field.predicate, subject); return; }
  const field = getRuntimeField(subject, ast.field.kind === "attr" ? ast.field.path : ast.field.key);
  if (!field.ops.includes(ast.op)) throw new Error(`Operator '${ast.op}' is not supported for '${field.key}'`);
}
