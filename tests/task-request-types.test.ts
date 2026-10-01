/**
 * Task request types (lib/tasks/request-types.ts) must agree with the
 * dashboards that classify tasks. The New task form used to save "financial",
 * which no dashboard counted as financial — these tests stop that drift.
 */
import { describe, expect, it } from "vitest";
import {
  FINANCIAL_REQUEST_KEYS,
  REQUEST_TYPES,
  REQUEST_TYPE_BY_KEY,
  categoryOfType,
  requestTypesFor,
} from "@/lib/tasks/request-types";
import { FINANCIAL_TASK_TYPES } from "@/lib/dashboard/my/window";
import { OPS_TYPES } from "@/lib/dashboard/ops/window";

describe("task request types", () => {
  it("has unique keys", () => {
    const keys = REQUEST_TYPES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts every financial request — and the old bare 'financial' — as financial on the dashboards", () => {
    const fin = new Set<string>(FINANCIAL_TASK_TYPES);
    for (const k of FINANCIAL_REQUEST_KEYS) expect(fin.has(k), k).toBe(true);
  });

  it("never counts a non-financial request as financial", () => {
    const fin = new Set<string>(FINANCIAL_TASK_TYPES);
    for (const r of requestTypesFor("non_financial")) expect(fin.has(r.key), r.key).toBe(false);
  });

  it("treats every request as operations work on the Operations Dashboard", () => {
    const ops = new Set<string>(OPS_TYPES);
    for (const r of REQUEST_TYPES) expect(ops.has(r.key), r.key).toBe(true);
  });

  it("maps stored types to their category", () => {
    expect(categoryOfType("redemption")).toBe("financial");
    expect(categoryOfType("financial")).toBe("financial");
    expect(categoryOfType("nominee_update")).toBe("non_financial");
    expect(categoryOfType("non_financial")).toBe("non_financial");
    expect(categoryOfType("follow_up")).toBe("general");
    expect(categoryOfType(null)).toBe("general");
  });

  it("gives every financial request an amount field", () => {
    for (const r of requestTypesFor("financial")) expect(r.fields, r.key).toContain("amount");
    expect(REQUEST_TYPE_BY_KEY.switch.fields).toContain("toScheme");
  });
});
