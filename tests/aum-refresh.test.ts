import { describe, expect, it } from "vitest";
import { runAumRefresh, type AumRefreshDeps } from "../src/workers/aum-refresh";
import { describeRun } from "../src/workers/scheduler-state";

const stats = (over: Record<string, number> = {}) => ({
  folios: 10, legs: 20, pricedByCode: 15, pricedByName: 4, unpriced: 1, unpricedValue: 250000, ...over,
});

function deps(over: Partial<AumRefreshDeps> = {}): AumRefreshDeps {
  return {
    listTenants: async () => ["a", "b", "c"],
    revalueFolios: async () => stats(),
    recomputeAum: async () => ({ updated: 7, skippedUnpriced: 2 }),
    concurrency: 2,
    ...over,
  };
}

describe("runAumRefresh", () => {
  it("adds up every firm's figures", async () => {
    const r = await runAumRefresh(deps());
    expect(r.tenants).toBe(3);
    expect(r.failedTenants).toEqual([]);
    expect(r.totals).toEqual({
      foliosRevalued: 30, legsUnpriced: 3, legsUnpricedValue: 750000, aumRevalued: 21, aumSkippedUnpriced: 6,
    });
  });

  it("one firm failing leaves the others saved and is reported", async () => {
    const saved: string[] = [];
    const r = await runAumRefresh(deps({
      recomputeAum: async (t) => {
        if (t === "b") throw new Error("statement timeout");
        saved.push(t);
        return { updated: 1, skippedUnpriced: 0 };
      },
    }));
    expect(saved.sort()).toEqual(["a", "c"]);
    expect(r.failedTenants).toEqual(["b"]);
    expect(r.totals.aumRevalued).toBe(2);
  });

  it("still saves clients when the folio reprice fails", async () => {
    let recomputed = 0;
    const r = await runAumRefresh(deps({
      listTenants: async () => ["a"],
      revalueFolios: async () => { throw new Error("boom"); },
      recomputeAum: async () => { recomputed++; return { updated: 4, skippedUnpriced: 0 }; },
    }));
    expect(recomputed).toBe(1);
    expect(r.failedTenants).toEqual(["a"]);
    expect(r.totals.aumRevalued).toBe(4);
  });

  it("a failed firm makes the recorded run partial, not ok", async () => {
    const r = await runAumRefresh(deps({
      recomputeAum: async (t) => {
        if (t === "a") throw new Error("x");
        return { updated: 0, skippedUnpriced: 0 };
      },
    }));
    expect(describeRun(r, "scheduled").status).toBe("partial");
    expect(describeRun(await runAumRefresh(deps()), "scheduled").status).toBe("ok");
  });

  it("handles no firms", async () => {
    const r = await runAumRefresh(deps({ listTenants: async () => [] }));
    expect(r.tenants).toBe(0);
    expect(r.failedTenants).toEqual([]);
  });
});
