/**
 * New task remembers the last type and priority (forms/task-prefs) — per
 * account, and never over what the screen was opened with.
 */
const mockDisk = new Map<string, string>();
jest.mock("../../../lib/bulkStorage", () => ({
  bulkGet: jest.fn(async (k: string) => mockDisk.get(k) ?? null),
  bulkSet: jest.fn(async (k: string, v: string) => { mockDisk.set(k, v); }),
  bulkDelete: jest.fn(async (k: string) => { mockDisk.delete(k); }),
}));

import { loadTaskPrefs, parseTaskPrefs, restoreTaskPrefs, saveTaskPrefs } from "../task-prefs";
import { setAccountScope } from "../../../lib/accountScope";

const requestCategory = (k: string) => (({ redemption: "financial", nominee_update: "non_financial", motor_renewal: "insurance" }) as Record<string, any>)[k] ?? null;
const ctx = (over: Partial<Parameters<typeof restoreTaskPrefs>[1]> = {}) => ({ prefilled: false, insuranceAllowed: false, requestCategory, ...over });

describe("reading what was saved", () => {
  it("keeps only a real type and priority", () => {
    expect(parseTaskPrefs(JSON.stringify({ type: "redemption", priority: "high" }))).toEqual({ type: "redemption", priority: "high" });
    expect(parseTaskPrefs(JSON.stringify({ priority: "panic" }))).toBeNull();
    expect(parseTaskPrefs("not json")).toBeNull();
    expect(parseTaskPrefs(null)).toBeNull();
  });
});

describe("what New task starts on", () => {
  it("restores a request with its category, and the priority", () => {
    expect(restoreTaskPrefs({ type: "redemption", priority: "high" }, ctx())).toEqual({ priority: "high", category: "financial", requestKey: "redemption" });
  });
  it("restores a custom kind and a plain follow-up", () => {
    expect(restoreTaskPrefs({ type: "Portfolio rebalance" }, ctx())).toEqual({ category: "general", kind: "custom", customType: "Portfolio rebalance" });
    expect(restoreTaskPrefs({ type: "follow_up" }, ctx())).toEqual({ category: "general", kind: "follow_up" });
  });
  it("only the priority for a task opened prefilled (a card's follow-up)", () => {
    expect(restoreTaskPrefs({ type: "redemption", priority: "urgent" }, ctx({ prefilled: true }))).toEqual({ priority: "urgent" });
  });
  it("never an Insurance request on a firm without it, nor a bare category", () => {
    expect(restoreTaskPrefs({ type: "motor_renewal", priority: "low" }, ctx())).toEqual({ priority: "low" });
    expect(restoreTaskPrefs({ type: "motor_renewal" }, ctx({ insuranceAllowed: true }))).toEqual({ category: "insurance", requestKey: "motor_renewal" });
    expect(restoreTaskPrefs({ type: "financial" }, ctx())).toEqual({});
  });
  it("nothing when nothing was saved", () => {
    expect(restoreTaskPrefs(null, ctx())).toEqual({});
  });
});

describe("per account, on the phone", () => {
  beforeEach(() => mockDisk.clear());
  it("saves and loads under the signed-in account only", async () => {
    setAccountScope("tenant.a");
    await saveTaskPrefs({ type: "redemption", priority: "high" });
    expect(await loadTaskPrefs()).toEqual({ type: "redemption", priority: "high" });
    setAccountScope("tenant.b");
    expect(await loadTaskPrefs()).toBeNull();
    setAccountScope(null);
    await saveTaskPrefs({ type: "follow_up" });
    expect(mockDisk.size).toBe(1);
  });
});
