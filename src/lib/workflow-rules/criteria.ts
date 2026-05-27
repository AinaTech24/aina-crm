/**
 * Criteria evaluation — runs the criteriaPattern + criteriaRows against a
 * single record snapshot. Used by the rule runner to decide whether a rule
 * matches an event.
 *
 * The pattern string supports:
 *   - 1-based row references: "1", "2", …
 *   - Logical operators: AND, OR, NOT
 *   - Parentheses for grouping: "(1 AND 2) OR 3"
 *   - Default (when pattern is null): AND of all rows
 *
 * Operators mirror Zoho's:
 *   - is / is_not / contains / starts_with / ends_with
 *   - is_empty / is_not_empty
 *   - greater_than / less_than / greater_or_equal / less_or_equal
 *   - between / in / not_in
 *   - today / yesterday / tomorrow / last_n_days / next_n_days
 */

import type { CriteriaRow, CriteriaOperator } from "./types";

export type RecordSnapshot = Record<string, unknown>;

export function evaluateCriteria(
  rows: CriteriaRow[],
  pattern: string | null | undefined,
  record: RecordSnapshot
): boolean {
  if (!rows || rows.length === 0) return true;
  const results = rows.map((r) => evaluateRow(r, record));

  // Default: AND of all rows
  if (!pattern || !pattern.trim()) {
    return results.every(Boolean);
  }
  return evaluatePattern(pattern, results);
}

function evaluateRow(row: CriteriaRow, record: RecordSnapshot): boolean {
  const fieldValue = readField(record, row.field);
  return applyOperator(row.operator, fieldValue, row.value);
}

function readField(record: RecordSnapshot, key: string): unknown {
  if (key in record) return record[key];
  // Try snake → camel
  const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (camel in record) return record[camel];
  return undefined;
}

function applyOperator(op: CriteriaOperator, left: unknown, right: unknown): boolean {
  const l = left;
  switch (op) {
    case "is":
      return loose(l) === loose(right);
    case "is_not":
      return loose(l) !== loose(right);
    case "contains":
      return strOf(l).toLowerCase().includes(strOf(right).toLowerCase());
    case "starts_with":
      return strOf(l).toLowerCase().startsWith(strOf(right).toLowerCase());
    case "ends_with":
      return strOf(l).toLowerCase().endsWith(strOf(right).toLowerCase());
    case "is_empty":
      return l === null || l === undefined || l === "";
    case "is_not_empty":
      return !(l === null || l === undefined || l === "");
    case "greater_than":
      return numOf(l) > numOf(right);
    case "less_than":
      return numOf(l) < numOf(right);
    case "greater_or_equal":
      return numOf(l) >= numOf(right);
    case "less_or_equal":
      return numOf(l) <= numOf(right);
    case "between": {
      if (!Array.isArray(right) || right.length !== 2) return false;
      const v = numOf(l);
      return v >= numOf(right[0]) && v <= numOf(right[1]);
    }
    case "in": {
      const arr = Array.isArray(right) ? right : String(right ?? "").split(",");
      return arr.map(loose).includes(loose(l));
    }
    case "not_in": {
      const arr = Array.isArray(right) ? right : String(right ?? "").split(",");
      return !arr.map(loose).includes(loose(l));
    }
    case "today":
      return isSameDay(parseDate(l), new Date());
    case "yesterday": {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return isSameDay(parseDate(l), y);
    }
    case "tomorrow": {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      return isSameDay(parseDate(l), t);
    }
    case "last_n_days": {
      const n = numOf(right);
      const d = parseDate(l);
      if (!d) return false;
      const ago = new Date();
      ago.setDate(ago.getDate() - n);
      return d <= new Date() && d >= ago;
    }
    case "next_n_days": {
      const n = numOf(right);
      const d = parseDate(l);
      if (!d) return false;
      const ahead = new Date();
      ahead.setDate(ahead.getDate() + n);
      return d >= new Date() && d <= ahead;
    }
    default:
      return false;
  }
}

function loose(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}
function strOf(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}
function numOf(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}
function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
function isSameDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ---------------------------------------------------------------------------
// Pattern parser — "1 AND (2 OR 3)" → boolean
// ---------------------------------------------------------------------------

type Token =
  | { kind: "ref"; index: number }
  | { kind: "and" | "or" | "not" | "lparen" | "rparen" };

function tokenize(pattern: string): Token[] {
  const tokens: Token[] = [];
  const src = pattern.toUpperCase();
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      tokens.push({ kind: "ref", index: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (src.startsWith("AND", i)) {
      tokens.push({ kind: "and" });
      i += 3;
      continue;
    }
    if (src.startsWith("OR", i)) {
      tokens.push({ kind: "or" });
      i += 2;
      continue;
    }
    if (src.startsWith("NOT", i)) {
      tokens.push({ kind: "not" });
      i += 3;
      continue;
    }
    throw new Error(`Invalid pattern character at ${i}: ${c}`);
  }
  return tokens;
}

// Recursive-descent: expr → or-list, or → and-list, and → not, not → primary
function evaluatePattern(pattern: string, results: boolean[]): boolean {
  try {
    const tokens = tokenize(pattern);
    let pos = 0;

    function peek(): Token | undefined {
      return tokens[pos];
    }
    function eat(kind: Token["kind"]): boolean {
      if (peek()?.kind === kind) {
        pos++;
        return true;
      }
      return false;
    }

    function primary(): boolean {
      const t = peek();
      if (!t) throw new Error("Unexpected end of pattern");
      if (t.kind === "lparen") {
        pos++;
        const v = orExpr();
        if (!eat("rparen")) throw new Error("Missing )");
        return v;
      }
      if (t.kind === "ref") {
        pos++;
        const idx = t.index - 1;
        return results[idx] ?? false;
      }
      throw new Error("Unexpected token");
    }
    function notExpr(): boolean {
      if (eat("not")) return !notExpr();
      return primary();
    }
    function andExpr(): boolean {
      let v = notExpr();
      while (eat("and")) v = notExpr() && v;
      return v;
    }
    function orExpr(): boolean {
      let v = andExpr();
      while (eat("or")) v = andExpr() || v;
      return v;
    }

    const result = orExpr();
    return result;
  } catch {
    // Fall back to AND of all
    return results.every(Boolean);
  }
}
