import { describe, expect, it } from "vitest";
import {
  MULTI_FINANCIAL,
  MULTI_SERVICE,
  channelOfLines,
  checklistForLines,
  lineColumns,
  lineProblem,
  taskTypeForLines,
  titleForLines,
  totalOfLines,
  type RequestLine,
} from "@/lib/tasks/request-lines";
import { FINANCIAL_REQUEST_KEYS, REQUEST_TYPE_BY_KEY, RTA_DATA_CHECK, categoryOfType } from "@/lib/tasks/request-types";
import { FINANCIAL_TASK_TYPES } from "@/lib/dashboard/my/window";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const line = (p: Partial<RequestLine>): RequestLine => ({ investorId: A, investorName: "Asha", requestKey: "sip_registration", ...p });

describe("request table — task type", () => {
  it("keeps the request's own key when every row is the same request", () => {
    expect(taskTypeForLines([line({}), line({ investorId: B })])).toBe("sip_registration");
  });
  it("is multi_financial when any row moves money, multi_service otherwise", () => {
    expect(taskTypeForLines([line({}), line({ requestKey: "nominee_update" })])).toBe(MULTI_FINANCIAL);
    expect(taskTypeForLines([line({ requestKey: "nominee_update" }), line({ requestKey: "ins_renewal" })])).toBe(MULTI_SERVICE);
  });
  it("is counted as financial / non-financial everywhere", () => {
    expect(categoryOfType(MULTI_FINANCIAL)).toBe("financial");
    expect(categoryOfType(MULTI_SERVICE)).toBe("non_financial");
    expect(FINANCIAL_REQUEST_KEYS).toContain(MULTI_FINANCIAL);
    expect(FINANCIAL_TASK_TYPES as readonly string[]).toContain(MULTI_FINANCIAL);
    expect(FINANCIAL_TASK_TYPES as readonly string[]).not.toContain(MULTI_SERVICE);
  });
});

describe("request table — checklist", () => {
  it("one request: its own list", () => {
    expect(checklistForLines([line({}), line({})])).toEqual(REQUEST_TYPE_BY_KEY.sip_registration.checklist);
  });
  it("several requests: each list named by its request, one RTA data check at the end", () => {
    const list = checklistForLines([line({}), line({ requestKey: "purchase" }), line({ requestKey: "nominee_update" })]);
    expect(list.filter((x) => x === RTA_DATA_CHECK)).toHaveLength(1);
    expect(list[list.length - 1]).toBe(RTA_DATA_CHECK);
    expect(list.some((x) => x.startsWith("SIP registration · "))).toBe(true);
    expect(list.some((x) => x.startsWith("Nominee update · "))).toBe(true);
  });
  it("a redemption takes its route's list when the rows agree (flag)", () => {
    const list = checklistForLines([line({ requestKey: "redemption", mode: "online" })], { redemptionRoute: true });
    expect(list).toContain("Entry on platform");
  });
});

describe("request table — title, total, mode", () => {
  it("names up to two requests and the family", () => {
    expect(titleForLines([line({})], "Asha")).toBe("SIP registration — Asha");
    expect(titleForLines([line({}), line({ requestKey: "purchase", investorId: B }), line({ requestKey: "swp" })], "Asha")).toBe(
      "SIP registration, Purchase (lumpsum) + 1 more — Asha & family",
    );
    expect(titleForLines([line({ requestKey: "kyc_renewal", mode: "physical" })], "Asha")).toBe("Physical KYC — Asha");
  });
  it("totals the amounts and keeps a mode only when the rows agree", () => {
    expect(totalOfLines([line({ amount: 5000 }), line({ amount: 2500 }), line({})])).toBe(7500);
    expect(totalOfLines([line({})])).toBeNull();
    expect(channelOfLines([line({ mode: "online" }), line({ mode: "online" }), line({})])).toBe("online");
    expect(channelOfLines([line({ mode: "online" }), line({ mode: "offline" })])).toBeNull();
  });
});

describe("request table — columns and checks", () => {
  it("asks only what the request uses", () => {
    expect([...lineColumns(REQUEST_TYPE_BY_KEY.switch)]).toEqual(expect.arrayContaining(["fromScheme", "scheme", "units", "mode"]));
    expect(lineColumns(REQUEST_TYPE_BY_KEY.nominee_update).has("scheme")).toBe(false);
    expect(lineColumns(REQUEST_TYPE_BY_KEY.kyc_renewal).has("mode")).toBe(true);
    expect(lineColumns(REQUEST_TYPE_BY_KEY.ins_renewal).has("folio")).toBe(true);
  });
  it("says what a row is missing", () => {
    expect(lineProblem(line({ requestKey: "" }), 0)).toMatch(/Row 1: pick the request/);
    expect(lineProblem(line({}), 1)).toMatch(/Row 2: pick the scheme/);
    expect(lineProblem(line({ requestKey: "switch", schemeName: "X" }), 0)).toMatch(/moves from/);
    expect(lineProblem(line({ requestKey: "kyc_renewal" }), 0)).toMatch(/Online KYC or Physical KYC/);
    expect(lineProblem(line({ requestKey: "nominee_update" }), 0)).toBeNull();
    expect(lineProblem(line({ schemeName: "HDFC Flexi Cap" }), 0)).toBeNull();
  });
});
