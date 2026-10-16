/**
 * Task request types (lib/tasks/request-types.ts) must agree with the
 * dashboards that classify tasks. The New task form used to save "financial",
 * which no dashboard counted as financial — these tests stop that drift.
 */
import { describe, expect, it } from "vitest";
import { TXN_FREQUENCIES, TXN_TYPES } from "@/db/schema/business_entries";
import {
  FINANCIAL_REQUEST_KEYS,
  FREQUENCIES,
  REQUEST_TYPES,
  REQUEST_TYPE_BY_KEY,
  categoryOfType,
  requestTypesFor,
} from "@/lib/tasks/request-types";
import { FINANCIAL_TASK_TYPES } from "@/lib/dashboard/my/window";
import { OPS_TYPES } from "@/lib/dashboard/ops/window";

describe("task request types", () => {
  it("ends every request, financial or not, with an RTA data check sub-task", () => {
    for (const r of REQUEST_TYPES) {
      expect(r.checklist[r.checklist.length - 1], r.key).toBe("RTA data check");
      expect(r.checklist.filter((c) => c === "RTA data check"), r.key).toHaveLength(1);
    }
  });

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

  it("asks every financial request for an amount — per scheme row, or once for a mandate", () => {
    for (const r of requestTypesFor("financial")) {
      if (!r.fields.length && !r.rowFields.length) continue; // e.g. nothing to capture
      expect([...r.fields, ...r.rowFields], r.key).toContain("amount");
    }
    expect(REQUEST_TYPE_BY_KEY.switch.rowFields).toEqual(expect.arrayContaining(["fromScheme", "scheme"]));
  });

  it("books Business entries only with valid transaction types, from scheme rows", () => {
    const txn = new Set<string>(TXN_TYPES);
    for (const r of REQUEST_TYPES.filter((x) => x.business)) {
      expect(txn.has(r.business!.txnType), r.key).toBe(true);
      expect(r.rowFields, r.key).toContain("scheme");
      expect(r.category, r.key).toBe("financial");
    }
    // Mandates and rejection follow-ups are not booked business.
    expect(REQUEST_TYPE_BY_KEY.mandate_create.business).toBeUndefined();
    expect(REQUEST_TYPE_BY_KEY.sip_rejection_followup.business).toBeUndefined();
  });

  it("offers only frequencies a Business entry line accepts", () => {
    const allowed = new Set<string>(TXN_FREQUENCIES);
    for (const [k] of FREQUENCIES) expect(allowed.has(k), k).toBe(true);
  });
});
