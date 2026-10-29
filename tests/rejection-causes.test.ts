import { describe, expect, it } from "vitest";
import { fishboneFrom, rejectionCause } from "@/lib/dashboard/ops/rejection-causes";
import { classifyScheme } from "@/lib/metrics/asset-class";

describe("SIP rejection causes", () => {
  it("reads the team's category first", () => {
    expect(rejectionCause("insufficient_balance", "anything")).toEqual({ group: "Bank", cause: "Low balance" });
    expect(rejectionCause("technical", null).group).toBe("Payment system");
  });

  it("reads the registrar's words", () => {
    expect(rejectionCause(null, "Insufficient Funds").cause).toBe("Low balance");
    expect(rejectionCause(null, "BALANCE INSUFFICIENT").cause).toBe("Low balance");
    expect(rejectionCause(null, "Account Closed").cause).toBe("Account closed");
    expect(rejectionCause(null, "Payment stopped by customer").cause).toBe("Stopped by client");
    expect(rejectionCause(null, "Customer opted Cancellation").cause).toBe("Stopped by client");
    expect(rejectionCause(null, "Amount exceeds mandate limit").cause).toBe("Over the mandate limit");
    expect(rejectionCause(null, "Mandate not registered").cause).toBe("Mandate not registered");
    expect(rejectionCause(null, "Mandate Cancelled").cause).toBe("Mandate expired / cancelled");
    expect(rejectionCause(null, "Invalid account number").cause).toBe("Wrong bank details");
    expect(rejectionCause(null, "Three consecutive reversals").cause).toBe("Debit returned");
    expect(rejectionCause(null, "NPCI timeout").cause).toBe("Technical / NACH");
  });

  it("keeps unknown words as their own cause, and a blank reason as a gap", () => {
    expect(rejectionCause(null, "Something unusual")).toEqual({ group: "Other", cause: "Something unusual" });
    expect(rejectionCause(null, "  ")).toEqual({ group: "Not recorded", cause: "Reason not recorded" });
  });

  it("builds bones largest first, three causes each, the gap kept apart", () => {
    const f = fishboneFrom([
      { cause: { group: "Bank", cause: "Low balance" }, count: 40 },
      { cause: { group: "Bank", cause: "Account closed" }, count: 5 },
      { cause: { group: "Bank", cause: "Account frozen" }, count: 2 },
      { cause: { group: "Bank", cause: "Signature mismatch" }, count: 1 },
      { cause: { group: "Mandate", cause: "Mandate not registered" }, count: 20 },
      { cause: { group: "Not recorded", cause: "Reason not recorded" }, count: 9 },
    ]);
    expect(f.unrecorded).toBe(9);
    expect(f.bones.map((b) => b.name)).toEqual(["Bank", "Mandate"]);
    expect(f.bones[0].causes).toEqual([
      { label: "Low balance", count: 40 }, { label: "Account closed", count: 5 }, { label: "Other", count: 3 },
    ]);
  });
});

describe("scheme asset class", () => {
  it("reads the AMFI category", () => {
    expect(classifyScheme("Equity Scheme - Large Cap Fund")).toEqual({ assetClass: "Equity", category: "Large Cap" });
    expect(classifyScheme("Debt Scheme - Liquid Fund")).toEqual({ assetClass: "Debt", category: "Liquid" });
    expect(classifyScheme("Hybrid Scheme - Balanced Advantage")).toEqual({ assetClass: "Hybrid", category: "Balanced Advantage" });
    expect(classifyScheme("Other Scheme - Index Funds").assetClass).toBe("Other");
    expect(classifyScheme("Solution Oriented Scheme - Retirement Fund").assetClass).toBe("Solution oriented");
  });

  it("falls back to the registrar's words, and calls a blank a gap", () => {
    expect(classifyScheme("ELSS").assetClass).toBe("Equity");
    expect(classifyScheme("Liquid").assetClass).toBe("Debt");
    expect(classifyScheme("Arbitrage").assetClass).toBe("Hybrid");
    expect(classifyScheme(null).assetClass).toBe("Category not recorded");
  });
});
