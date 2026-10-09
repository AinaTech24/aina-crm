import { describe, expect, it } from "vitest";
import { cleanPlanPayload, describeIssues, planProblems } from "@/lib/financial-plans/payload";

const base = {
  investorId: "11111111-1111-4111-8111-111111111111",
  status: "draft",
  clientAge: 40,
  spouseAge: null,
  childrenDetails: [],
  monthlyIncome: 100000,
  monthlyExpenses: 60000,
  assets: [],
  liabilities: [],
  emergencyFundTargetMonths: 6,
  emergencyFundCurrentValue: 0,
  goals: [],
  recommendedEquityPct: 60,
  recommendedDebtPct: 20,
  recommendedGoldPct: 20,
  recommendedCashPct: 0,
  recommendations: [],
  savingsRate: 40,
  emiToIncomePct: 0,
};

describe("cleanPlanPayload", () => {
  it("drops rows that were added but never filled in", () => {
    const p = cleanPlanPayload({
      ...base,
      assets: [{ category: "equity", name: "", value: 0 }, { category: "gold", name: "Sovereign bond", value: 50000 }],
      liabilities: [{ name: "", value: 0 }],
      recommendations: [
        { category: "investment", action: "", priority: "medium" },
        { category: "emergency", action: "  Build a 6-month emergency fund  ", priority: "high" },
      ],
      childrenDetails: [{ name: "", age: 0 }],
    });
    expect(p.assets).toEqual([{ category: "gold", name: "Sovereign bond", value: 50000 }]);
    expect(p.liabilities).toEqual([]);
    expect(p.recommendations).toEqual([{ category: "emergency", action: "Build a 6-month emergency fund", priority: "high" }]);
    expect(p.childrenDetails).toEqual([]);
  });

  it("names a filled row the user left unnamed instead of failing", () => {
    const p = cleanPlanPayload({ ...base, assets: [{ category: "real_estate", name: " ", value: 2500000 }], liabilities: [{ name: "", value: 0, monthlyEmi: 12000 }] });
    expect(p.assets[0].name).toBe("Real estate");
    expect(p.liabilities[0]).toMatchObject({ name: "Loan", monthlyEmi: 12000 });
  });

  it("accepts an EMI ratio above 100% (EMIs larger than income) and caps only at the column's limit", () => {
    expect(cleanPlanPayload({ ...base, emiToIncomePct: 140 }).emiToIncomePct).toBe(140);
    expect(cleanPlanPayload({ ...base, emiToIncomePct: 5000 }).emiToIncomePct).toBe(999);
  });

  it("rounds whole-number fields and turns non-finite numbers into absent values", () => {
    const p = cleanPlanPayload({
      ...base,
      clientAge: 35.6,
      recommendedEquityPct: 59.6,
      goals: [{ category: "car", name: "Car", targetAmount: 800000, targetYears: 3.4, inflationRate: 6, expectedReturn: 10, futureValue: Number.NaN, gapAmount: -500 }],
    });
    expect(p.clientAge).toBe(36);
    expect(p.recommendedEquityPct).toBe(60);
    expect(p.goals[0].targetYears).toBe(3);
    expect(p.goals[0]).not.toHaveProperty("futureValue");
    expect(p.goals[0].gapAmount).toBe(0);
  });
});

describe("planProblems", () => {
  it("passes a complete plan", () => {
    expect(planProblems(cleanPlanPayload(base))).toEqual([]);
  });

  it("names a goal with no years (e.g. imported from a fact-find) and sends the user to step 4", () => {
    const p = cleanPlanPayload({ ...base, goals: [{ category: "retirement", name: "Retirement", targetAmount: 50000000, targetYears: 0, inflationRate: 6, expectedReturn: 12 }] });
    const probs = planProblems(p);
    expect(probs[0]).toEqual({ step: 4, message: 'Goal "Retirement" needs the number of years to the goal (1–100).' });
  });

  it("orders problems by step", () => {
    const p = cleanPlanPayload({ ...base, emergencyFundTargetMonths: 48, childrenDetails: [{ name: "", age: 7 }] });
    expect(planProblems(p).map((x) => x.step)).toEqual([1, 3]);
  });
});

describe("describeIssues", () => {
  it("turns the API's zod issues into a sentence that names the step and the row", () => {
    const d = describeIssues([{ path: ["recommendations", 1, "action"], message: "String must contain at least 1 character(s)" }]);
    expect(d?.step).toBe(5);
    expect(d?.message).toBe("Couldn't save: Step 5 (Roadmap) — Recommendation 2 · Action: String must contain at least 1 character(s)");
  });

  it("handles top-level fields and caps the list", () => {
    const d = describeIssues([
      { path: ["emiToIncomePct"], message: "Number must be less than or equal to 100" },
      { path: ["goals", 0, "targetYears"], message: "too small" },
      { path: ["assets", 2, "name"], message: "required" },
      { path: ["notes"], message: "x" },
    ]);
    expect(d?.step).toBe(2);
    expect(d?.message).toContain("Step 2 (Cash & Assets) — Emi To Income %: Number must be less than or equal to 100");
    expect(d?.message).toContain("Goal 1 · Target Years");
    expect(d?.message).toMatch(/\(\+1 more\)$/);
  });

  it("returns null when there are no issues", () => {
    expect(describeIssues(undefined)).toBeNull();
    expect(describeIssues([])).toBeNull();
  });
});
