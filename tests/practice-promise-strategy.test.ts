import { describe, expect, it } from "vitest";
import {
  clientFlags,
  describePromise,
  everyPhrase,
  isKept,
  keptAll,
  keptPct,
  mergePromise,
  tally,
  worstItem,
  type ClientFacts,
  type Recorded,
  type ResolvedPromise,
} from "@/lib/practice/promise";
import {
  cleanFigures,
  direction,
  fyElapsed,
  fyEndYear,
  fyLabelOf,
  pathAskFor,
  pathToObjective,
  progressPct,
  strategyRows,
  trackStatus,
  type CurrentFigures,
  type Strategy,
} from "@/lib/practice/strategy";
import {
  compareGroup,
  groupPerformance,
  outcomeMetric,
  purposeKey,
  rate,
  twoProportionZ,
  type PerformanceRow,
} from "@/lib/practice/experiments";
import { DEFAULT_SERVICE_PROMISES } from "@/lib/practice/catalog";

/* ─────────────────────────────── promise ─────────────────────────────── */

const A: ResolvedPromise = { ...DEFAULT_SERVICE_PROMISES.A };
const ALL: Recorded = { review: true, call: true, statement: true, birthday: true, query: true };
const facts = (f: Partial<ClientFacts> = {}): ClientFacts => ({
  reviewDays: 10, contactDays: 5, statementDays: 3, birthdayDays: null, birthdayWished: false,
  queriesJudged: 0, queriesLate: 0, ...f,
});

describe("mergePromise", () => {
  it("takes the default for a key never set", () => {
    expect(mergePromise(A, {})).toEqual(A);
    expect(mergePromise(A, null)).toEqual(A);
  });
  it("keeps a stored value and a stored null (not promised)", () => {
    const m = mergePromise(A, { reviewEveryDays: 60, callEveryDays: null, birthdayWish: false });
    expect(m.reviewEveryDays).toBe(60);
    expect(m.callEveryDays).toBeNull();
    expect(m.birthdayWish).toBe(false);
    expect(m.statementEveryDays).toBe(A.statementEveryDays);
  });
  it("treats a non-positive stored cadence as not promised", () => {
    expect(mergePromise(A, { querySlaHours: 0 }).querySlaHours).toBeNull();
  });
});

describe("isKept / keptPct", () => {
  it("is null when the item is not promised", () => {
    expect(isKept(5, null)).toBeNull();
    expect(isKept(5, 0)).toBeNull();
  });
  it("never on record is a miss, within the cadence is kept, on the day is kept", () => {
    expect(isKept(null, 30)).toBe(false);
    expect(isKept(29, 30)).toBe(true);
    expect(isKept(30, 30)).toBe(true);
    expect(isKept(31, 30)).toBe(false);
  });
  it("keptPct is null with nobody eligible, one decimal otherwise", () => {
    expect(keptPct(0, 0)).toBeNull();
    expect(keptPct(1, 3)).toBe(33.3);
    expect(keptPct(3, 3)).toBe(100);
  });
});

describe("clientFlags / keptAll", () => {
  it("an unrecorded item is null, never a miss", () => {
    const f = clientFlags(facts({ statementDays: null }), A, { ...ALL, statement: false });
    expect(f.statement).toBeNull();
  });
  it("birthday applies only with a birthday on record; query only with a judged request", () => {
    const f = clientFlags(facts(), A, ALL);
    expect(f.birthday).toBeNull();
    expect(f.query).toBeNull();
    const g = clientFlags(facts({ birthdayDays: 12, birthdayWished: true, queriesJudged: 2, queriesLate: 1 }), A, ALL);
    expect(g.birthday).toBe(true);
    expect(g.query).toBe(false);
  });
  it("kept all = every applicable item kept; null when nothing applies", () => {
    expect(keptAll(clientFlags(facts(), A, ALL))).toBe(true);
    expect(keptAll(clientFlags(facts({ contactDays: 90 }), A, ALL))).toBe(false);
    const none: Recorded = { review: false, call: false, statement: false, birthday: false, query: false };
    expect(keptAll(clientFlags(facts(), A, none))).toBeNull();
  });
});

describe("tally", () => {
  it("counts per item and overall over the clients in the tier", () => {
    const rows = [
      { promise: A, flags: clientFlags(facts(), A, ALL) },
      { promise: A, flags: clientFlags(facts({ contactDays: 60 }), A, ALL) },
      { promise: A, flags: clientFlags(facts({ reviewDays: null }), A, ALL) },
    ];
    const t = tally(rows, ALL);
    expect(t.clients).toBe(3);
    expect(t.keptAll).toBe(1);
    expect(t.keptPct).toBe(33.3);
    const call = t.items.find((i) => i.key === "call")!;
    expect(call).toMatchObject({ state: "measured", eligible: 3, kept: 2, pct: 66.7 });
    expect(t.items.find((i) => i.key === "query")!.state).toBe("none_due");
    expect(worstItem(t.items)?.key).toBe("review");
  });
  it("an item not promised or not recorded has no percentage", () => {
    const p = { ...A, statementEveryDays: null };
    const t = tally([{ promise: p, flags: clientFlags(facts(), p, { ...ALL, birthday: false }) }], { ...ALL, birthday: false });
    expect(t.items.find((i) => i.key === "statement")).toMatchObject({ state: "not_promised", pct: null });
    expect(t.items.find((i) => i.key === "birthday")).toMatchObject({ state: "not_recorded", pct: null });
  });
  it("an empty tier reads its promise from the fallback", () => {
    const p = { ...A, callEveryDays: null };
    const t = tally([], ALL, p);
    expect(t.keptPct).toBeNull();
    expect(t.items.find((i) => i.key === "call")!.state).toBe("not_promised");
    expect(t.items.find((i) => i.key === "review")!.state).toBe("none_due");
  });
});

describe("describePromise", () => {
  it("says the promise in plain words", () => {
    expect(describePromise("A", A)).toBe(
      "Every A client: a portfolio review every quarter, a call every month, a statement every month, a birthday wish and every query answered within 24 hours.",
    );
    expect(describePromise("C", { reviewEveryDays: null, callEveryDays: null, statementEveryDays: null, birthdayWish: false, querySlaHours: null }))
      .toBe("Every C client: nothing promised yet.");
    expect(everyPhrase(45)).toBe("every 45 days");
  });
});

/* ─────────────────────────────── strategy ─────────────────────────────── */

describe("FY helpers", () => {
  it("names an FY by the year it ends in", () => {
    expect(fyEndYear("2026-10-08")).toBe(2027);
    expect(fyEndYear("2027-03-31")).toBe(2027);
    expect(fyEndYear("2027-04-01")).toBe(2028);
    expect(fyLabelOf(2027)).toBe("2026-27");
  });
  it("measures how far through the FY a day is", () => {
    expect(fyElapsed("2026-04-01")).toBe(0);
    expect(fyElapsed("2026-10-01")).toBeCloseTo(183 / 365, 3);
  });
});

describe("pathToObjective", () => {
  it("compounds money at a constant annual rate from the start of the FY", () => {
    // ₹100 at 1 Apr 2026 (FY2027) to ₹200 by 31 Mar 2031 (FY2031): 5 years.
    const p = pathToObjective(100, 200, 2027, 2031, 2027, { compound: true, elapsed: 0, baselineElapsed: 0 })!;
    expect(p.compound).toBe(true);
    expect(p.perYear).toBeCloseTo(Math.pow(2, 1 / 5) - 1, 10);
    expect(p.points.map((x) => x.fy)).toEqual([2027, 2028, 2029, 2030, 2031]);
    expect(p.points[4].needed).toBeCloseTo(200, 8);
    expect(p.neededThisYear).toBeCloseTo(100 * Math.pow(2, 1 / 5), 8);
    expect(p.expectedNow).toBeCloseTo(100, 8);
  });
  it("runs counts on a straight line", () => {
    const p = pathToObjective(1000, 2000, 2027, 2031, 2029, { compound: false, elapsed: 0.5, baselineElapsed: 0 })!;
    expect(p.perYear).toBe(200);
    expect(p.neededThisYear).toBe(1600);
    expect(p.neededAtYearStart).toBe(1400);
    expect(p.expectedNow).toBe(1500);
  });
  it("a baseline captured today reads exactly on track today", () => {
    const p = pathToObjective(500, 900, 2027, 2031, 2027, { compound: true, elapsed: 0.52, baselineElapsed: 0.52 })!;
    expect(p.expectedNow).toBeCloseTo(500, 8);
    expect(trackStatus(500, p.expectedNow, "up")).toBe("on_track");
    // The year's addition is a full FY at the path's rate, carried back before the baseline.
    expect(p.neededAtYearStart).toBeLessThan(500);
  });
  it("falls back to a straight line without a positive baseline", () => {
    const p = pathToObjective(0, 100, 2027, 2028, 2027, { compound: true, baselineElapsed: 0 })!;
    expect(p.compound).toBe(false);
    expect(p.neededThisYear).toBe(50);
  });
  it("stops at the objective after the objective year and is null without both ends", () => {
    const p = pathToObjective(100, 200, 2027, 2029, 2035, { compound: true, baselineElapsed: 0 })!;
    expect(p.neededThisYear).toBeCloseTo(200, 8);
    expect(p.expectedNow).toBeCloseTo(200, 8);
    expect(pathToObjective(null, 200, 2027, 2029, 2027)).toBeNull();
    expect(pathToObjective(100, 200, 2030, 2029, 2027)).toBeNull();
  });
  it("goes down for a falling figure (owner hours)", () => {
    const p = pathToObjective(60, 24, 2027, 2030, 2028, { elapsed: 1, baselineElapsed: 0 })!;
    expect(p.neededThisYear).toBe(42);
    expect(direction(60, 24)).toBe("down");
  });
});

describe("progress and status", () => {
  it("progress is current ÷ needed going up, needed ÷ current going down", () => {
    expect(progressPct(80, 100, "up")).toBe(80);
    expect(progressPct(50, 40, "down")).toBe(80);
    expect(progressPct(null, 100, "up")).toBeNull();
  });
  it("on track at or past the path, behind within 10%, well behind beyond; no figure is no data", () => {
    expect(trackStatus(100, 100, "up")).toBe("on_track");
    expect(trackStatus(95, 100, "up")).toBe("behind");
    expect(trackStatus(80, 100, "up")).toBe("well_behind");
    expect(trackStatus(44, 40, "down")).toBe("behind");
    expect(trackStatus(null, 100, "up")).toBe("no_data");
  });
  it("the path's ask is a closing figure or the year's addition", () => {
    const p = pathToObjective(1000, 2000, 2027, 2031, 2028, { baselineElapsed: 0 })!;
    expect(pathAskFor(p, "closing")).toBe(1400);
    expect(pathAskFor(p, "addition")).toBe(200);
  });
  it("cleanFigures drops blanks and nonsense", () => {
    expect(cleanFigures({ aum: 5, clients: null, sipBook: Number.NaN, teamSize: -1 })).toEqual({ aum: 5 });
  });
});

describe("strategyRows", () => {
  const s: Strategy = {
    primaryAim: "Three days a week by 2031",
    objectiveYear: 2031,
    targets: { aum: 5e9, clients: 2000, revenue: 1e8, ownerHoursPerWeek: 24 },
    baseline: { aum: 2.5e9, clients: 1000, ownerHoursPerWeek: 60, ownerHoursNow: 55, ownerHoursNowOn: "2026-09-01", capturedOn: "2026-04-01" },
    baselineYear: 2027,
    baselineElapsed: 0,
    updatedAt: null,
  };
  const current: CurrentFigures = {
    aum: 2.6e9, clients: 1010, sipBook: 1e7, revenue: null, teamSize: 8, ownerHoursPerWeek: null, revenueNote: "No brokerage statement has been imported.",
  };
  const rows = strategyRows(s, current, { aum: { value: 3e9, kind: "closing", source: "firm target" } }, new Date("2026-10-08T06:00:00Z"));
  it("has a row per figure the objective sets", () => {
    expect(rows.map((r) => r.key)).toEqual(["aum", "clients", "revenue", "ownerHoursPerWeek"]);
  });
  it("revenue without statements is no data, never zero", () => {
    const r = rows.find((x) => x.key === "revenue")!;
    expect(r.current).toBeNull();
    expect(r.status).toBe("no_data");
    expect(r.currentNote).toMatch(/brokerage/);
  });
  it("owner hours come from the owner's own statement", () => {
    const r = rows.find((x) => x.key === "ownerHoursPerWeek")!;
    expect(r.current).toBe(55);
    expect(r.dir).toBe("down");
  });
  it("puts this FY's annual target beside the path's ask", () => {
    const r = rows.find((x) => x.key === "aum")!;
    expect(r.fyTarget?.value).toBe(3e9);
    expect(r.fyTarget?.pathAsk).toBeCloseTo(2.5e9 * Math.pow(2, 1 / 5), 0);
  });
});

/* ─────────────────────────────── experiments ─────────────────────────────── */

describe("purposeKey", () => {
  it("takes a variant suffix off, never a drip step", () => {
    expect(purposeKey("birthday_wish")).toBe("birthday_wish");
    expect(purposeKey("birthday_wish_v2")).toBe("birthday_wish");
    expect(purposeKey("birthday_wish_b")).toBe("birthday_wish");
    expect(purposeKey("Welcome-ALT")).toBe("welcome");
    expect(purposeKey("drip_day_7")).toBe("drip_day_7");
  });
});

describe("two-proportion comparison", () => {
  it("z is positive when the first rate is higher and 0 without variance", () => {
    expect(twoProportionZ(40, 100, 20, 100)).toBeGreaterThan(1.96);
    expect(twoProportionZ(0, 50, 0, 50)).toBe(0);
    expect(twoProportionZ(1, 0, 1, 10)).toBe(0);
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(1, 0)).toBeNull();
  });
  it("needs two templates with 30+ sends", () => {
    expect(compareGroup([{ id: "a", sent: 100, hits: 40 }])).toEqual({ kind: "single" });
    expect(compareGroup([{ id: "a", sent: 100, hits: 40 }, { id: "b", sent: 29, hits: 1 }])).toEqual({ kind: "too_few", eligible: 1 });
    expect(compareGroup([{ id: "a", sent: 100, hits: null }, { id: "b", sent: 100, hits: null }])).toEqual({ kind: "no_metric" });
  });
  it("flags the better one only when the difference is significant", () => {
    const better = compareGroup([{ id: "a", sent: 100, hits: 20 }, { id: "b", sent: 100, hits: 40 }]);
    expect(better).toMatchObject({ kind: "better", winnerId: "b", runnerUpId: "a" });
    const close = compareGroup([{ id: "a", sent: 100, hits: 30 }, { id: "b", sent: 100, hits: 33 }]);
    expect(close).toMatchObject({ kind: "no_difference", leaderId: "b" });
  });
  it("judges on replies, then reads, then delivery", () => {
    expect(outcomeMetric({ delivered: true, read: true, replied: true })).toBe("replied");
    expect(outcomeMetric({ delivered: true, read: true, replied: false })).toBe("read");
    expect(outcomeMetric({ delivered: true, read: false, replied: false })).toBe("delivered");
    expect(outcomeMetric({ delivered: false, read: false, replied: false })).toBeNull();
  });
});

describe("groupPerformance", () => {
  const row = (p: Partial<PerformanceRow>): PerformanceRow => ({
    template_id: "t1", key: "sip_nudge", name: "SIP nudge", category: "marketing", channel: "whatsapp",
    attempted: 100, sent: 90, delivered: 85, read: 50, replied: 10, failed: 5, skipped: 10, ...p,
  });
  it("groups variants of one purpose on one channel and compares them", () => {
    const g = groupPerformance([
      row({}),
      row({ template_id: "t2", key: "sip_nudge_v2", name: "SIP nudge B", replied: 30 }),
      row({ template_id: "t3", key: "sip_nudge", channel: "email", name: "SIP nudge email", read: 0, replied: 0 }),
    ]);
    expect(g).toHaveLength(2);
    const wa = g.find((x) => x.channel === "whatsapp")!;
    expect(wa.templates).toHaveLength(2);
    expect(wa.metric).toBe("replied");
    expect(wa.comparison).toMatchObject({ kind: "better", winnerId: "t2" });
    expect(wa.templates[0].repliedPct).not.toBeNull();
  });
  it("a rate the channel never reported is null (Not reported), not 0%", () => {
    const g = groupPerformance([row({ channel: "sms", key: "otp", read: 0, replied: 0 }), row({ template_id: "t9", channel: "email", key: "news", read: 0, replied: 0 })]);
    const sms = g.find((x) => x.channel === "sms")!;
    expect(sms.reported).toEqual({ delivered: true, read: false, replied: false });
    expect(sms.templates[0].readPct).toBeNull();
    const email = g.find((x) => x.channel === "email")!;
    expect(email.templates[0].readPct).toBeNull();
    expect(email.templates[0].deliveredPct).toBe(94.4);
    expect(email.templates[0].failedPct).toBe(5);
  });
});
