/**
 * Tasks / meetings rules the app copies from the CRM, and the India-day maths
 * the task editor uses. The copies must stay byte-for-byte the CRM's (only the
 * header comment differs), so a change on main fails here instead of drifting.
 */

import { REQUEST_TYPES, REQUEST_TYPE_BY_KEY, INSURANCE_TASKS_FLAG, CATEGORY_LABEL, categoryOfType, fieldLabel, requestTypesFor, RTA_DATA_CHECK } from "../request-types";
import { istDay, onIstDay, taskForm } from "../../forms/tasks";

declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("fs");

/** The copy minus its "COPIED VERBATIM" header block (and the blank line after it). */
function body(copy: string): string {
  const end = copy.indexOf("*/");
  return copy.slice(end + 2).replace(/^\r?\n\r?\n?/, "");
}
const read = (p: string): string | null => { try { return fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n"); } catch { return null; } };
const ROOT = `${__dirname}/../../../../..`;

describe("verbatim copies of CRM rule files", () => {
  const pairs: Array<[string, string]> = [
    [`${__dirname}/../request-types.ts`, `${ROOT}/src/lib/tasks/request-types.ts`],
    [`${__dirname}/../../meetings/agenda.ts`, `${ROOT}/src/lib/review-meetings/agenda.ts`],
  ];
  for (const [copy, source] of pairs) {
    const src = read(source);
    // The mobile app can be checked out on its own; then there is nothing to compare with.
    (src == null ? it.skip : it)(`${copy.split("/").slice(-2).join("/")} matches the CRM`, () => {
      expect(body(read(copy)!)).toBe(src);
    });
  }
});

describe("Insurance task category (CRM a55681f7)", () => {
  it("is offered by the insuranceTasks flag and has its own requests", () => {
    expect(INSURANCE_TASKS_FLAG).toBe("insuranceTasks");
    expect(CATEGORY_LABEL.insurance).toBe("Insurance");
    expect(requestTypesFor("insurance").length).toBeGreaterThanOrEqual(12);
    expect(categoryOfType("ins_renewal")).toBe("insurance");
  });
  it("asks for the policy number in the folio slot and never adds the RTA check", () => {
    const renewal = REQUEST_TYPE_BY_KEY.ins_renewal;
    expect(fieldLabel("folio", renewal)).toBe("Policy number");
    expect(fieldLabel("amount", renewal)).toBe("Renewal premium (₹)");
    for (const r of REQUEST_TYPES.filter((x) => x.category === "insurance")) expect(r.checklist).not.toContain(RTA_DATA_CHECK);
    expect(fieldLabel("folio", REQUEST_TYPE_BY_KEY.redemption)).toBe("Folio number");
  });
});

describe("task editor India days", () => {
  it("reads a due stored as 18:30Z as the next India day", () => {
    expect(istDay("2026-11-20T18:30:00.000Z")).toBe("2026-11-21");
    expect(istDay("2026-11-20T04:30:00.000Z")).toBe("2026-11-20");
    expect(istDay(null)).toBe("");
    expect(istDay("2026-11-20")).toBe("2026-11-20");
  });
  it("moves a due to another day at the same India time", () => {
    expect(onIstDay("2026-11-25", "2026-11-20T04:30:00.000Z")).toBe("2026-11-25T04:30:00.000Z");
    expect(onIstDay("2026-11-25", "2026-11-20T18:30:00.000Z")).toBe("2026-11-24T18:30:00.000Z");
    expect(onIstDay("2026-11-25", null)).toBe("2026-11-25T00:00:00.000Z");
  });
  it("leaves an unchanged due alone and clears a removed SLA", () => {
    const rec = { title: "Call Ramesh", dueAt: "2026-11-20T18:30:00.000Z", slaDueAt: "2026-11-22T10:00:00.000Z", priority: "normal" };
    const form = taskForm.editInitial!(rec, {});
    expect(form.dueDate).toBe("2026-11-21");
    const same = taskForm.buildBody(form, {});
    expect(same.dueAt).toBeUndefined();
    expect("slaDueAt" in same).toBe(false);
    const moved = taskForm.buildBody({ ...form, dueDate: "2026-11-23", slaDueDate: "" }, {});
    expect(moved.dueAt).toBe("2026-11-22T18:30:00.000Z");
    expect(moved.slaDueAt).toBeNull();
  });
});
