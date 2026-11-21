/**
 * Markets & Mindset and Smart Decisions: each def against the web CRM — the web
 * module run on the same inputs (webModule) and the reference figures the web
 * module documents in its header.
 */

import { webModule } from "../testing/webModules";
import { run, statOf, tables } from "../testing/helpers";
import { DEFS } from "../defs/decisions";
import * as appCs from "../web/crash-stress";
import * as appFi from "../web/fire";
import * as appAd from "../web/advisory";
import * as appHo from "../web/housing-emi-sip";
import { inr, inrCompact, fmtPct } from "../fmt";
import type { ResultBlock } from "../types";

const webCs = webModule<typeof appCs>("calculators/crash-stress");
const webFi = webModule<typeof appFi>("calculators/fire");
const webAd = webModule<typeof appAd>("calculators/advisory");
const webHo = webModule<typeof appHo>("calculators/housing-emi-sip");

const texts = (b: ResultBlock[], type: "insight" | "note" | "section") =>
  b.flatMap((x) => (x.type === type ? [x.text] : []));
const stats = (b: ResultBlock[]) => b.flatMap((x) => (x.type === "stat" ? [x] : []));

describe("every Markets & Decisions def", () => {
  it.each(Object.keys(DEFS))("%s survives blank and zero inputs", (key) => {
    const body = DEFS[key];
    const zeros: Record<string, any> = {};
    const blanks: Record<string, any> = {};
    for (const i of body.inputs) {
      if (typeof i.default === "number") {
        zeros[i.key] = 0;
        blanks[i.key] = undefined;
      }
    }
    expect(() => run(body, zeros)).not.toThrow();
    expect(() => run(body, blanks)).not.toThrow();
  });
  it("covers the six catalog keys", () => {
    expect(Object.keys(DEFS).sort()).toEqual(["btid", "crash", "fire", "housingstrategy", "npsvsmf", "prepayinvest"]);
  });
});

describe("crash — Market-Crash Stress Test", () => {
  const base = { monthlySip: 25000, lumpsum: 0, years: 20, expectedReturnPct: 12, crashYear: 5, crashPct: 40, fdRatePct: 6 };
  it("prints the web's default case", () => {
    const w = webCs.computeCrashStress(base);
    const b = run(DEFS.crash);
    expect(statOf(b, "Stayed invested")).toBe(inr(w.finalStay));
    expect(statOf(b, "No-crash baseline")).toBe(inr(w.finalNoCrash));
    expect(statOf(b, "Panic-sold (→ FD)")).toBe(inr(w.finalPanic));
    expect(statOf(b, "Cost of panic")).toBe(inr(w.costOfPanic));
    expect(texts(b, "insight")[0]).toBe(
      `A 40% crash in year 5 wipes about ${inr(w.crashDropAmount)} off the corpus on paper. The market regains its pre-crash level in about ${Math.round((w.recoveryMonths! / 12) * 10) / 10} years; staying invested still reaches ${inr(w.finalStay)} (${inr(w.gapToNoCrash)} below the no-crash path). Panic-selling and parking in an FD instead would leave just ${inr(w.finalPanic)} — a ${inr(w.costOfPanic)} mistake.`,
    );
    const t = tables(b)[0];
    expect(t.head).toEqual(["Year", "Stayed invested", "No crash", "Panic-sold"]);
    expect(t.rows).toHaveLength(21); // year 0 … 20
    expect(t.rows[20]).toEqual(["20", inr(w.finalStay), inr(w.finalNoCrash), inr(w.finalPanic)]);
    expect(texts(b, "note")).toEqual(["Illustration of behaviour, not a market forecast. Crashes and recoveries vary."]);
  });
  it.each([
    { ...base, monthlySip: 10000, lumpsum: 500000, years: 15, expectedReturnPct: 11, crashYear: 3, crashPct: 55, fdRatePct: 7 },
    { ...base, years: 8, crashYear: 7.5, crashPct: 120 },
    { ...base, years: 10, crashYear: 12 },
  ])("computeCrashStress equals the web module (%#)", (input) => {
    const w = webCs.computeCrashStress(input);
    expect(appCs.computeCrashStress(input)).toEqual(w);
    const b = run(DEFS.crash, input);
    expect(statOf(b, "Stayed invested")).toBe(inr(w.finalStay));
    expect(statOf(b, "Cost of panic")).toBe(inr(w.costOfPanic));
    if (!w.crashInHorizon) {
      expect(texts(b, "insight")).toEqual([`Year ${input.crashYear} is outside the ${input.years}-year horizon — no crash is modelled.`]);
    } else {
      expect(texts(b, "insight")[0]).toContain(`A ${fmtPct(Math.min(100, input.crashPct))} crash in year ${input.crashYear}`);
    }
  });
});

describe("fire — FIRE Number", () => {
  const base = { currentAge: 32, monthlyExpenseNow: 80000, inflationPct: 6, preReturnPct: 12, postReturnPct: 8, currentCorpus: 2000000, monthlySip: 50000, sipStepUpPct: 8, swrPct: 4, lifeExpectancy: 90 };
  it("prints the web's default case", () => {
    const w = webFi.computeFire(base);
    const b = run(DEFS.fire);
    expect(statOf(b, "FIRE number (today's terms)")).toBe(inr(w.fireNumberToday));
    expect(statOf(b, "FIRE number (today's terms)")).toBe("₹2,40,00,000");
    expect(statOf(b, "Financial-independence age")).toBe(`${w.fireAge}`);
    expect(statOf(b, "Years to FI")).toBe(`${w.yearsToFire} yrs`);
    expect(statOf(b, "Corpus needed at FI")).toBe(inr(w.fireCorpus!));
    expect(texts(b, "insight")[0]).toContain(`reaches financial independence at age ${w.fireAge} (${w.yearsToFire} years away) with a corpus of ${inr(w.corpusAtFire!)} — enough to draw 4%/yr for living costs.`);
    expect(texts(b, "note")).toEqual(["SWR rule is a planning heuristic; sequence-of-returns risk and taxes can change outcomes."]);
  });
  it.each([
    { ...base, currentAge: 40, monthlyExpenseNow: 150000, currentCorpus: 10000000, monthlySip: 100000, sipStepUpPct: 5, swrPct: 3.5, postReturnPct: 6 },
    { ...base, monthlySip: 5000, sipStepUpPct: 0, currentCorpus: 0, lifeExpectancy: 70 },
    { ...base, swrPct: 0 },
  ])("computeFire equals the web module (%#)", (input) => {
    const w = webFi.computeFire(input);
    expect(appFi.computeFire(input)).toEqual(w);
    const b = run(DEFS.fire, input);
    expect(statOf(b, "FIRE number (today's terms)")).toBe(input.swrPct > 0 ? inr(w.fireNumberToday) : "—");
    expect(statOf(b, "Financial-independence age")).toBe(w.fireAge != null ? `${w.fireAge}` : "Beyond horizon");
    expect(statOf(b, "Corpus needed at FI")).toBe(w.fireCorpus != null ? inr(w.fireCorpus) : "—");
    const said = texts(b, "insight")[0];
    if (w.fireAge == null) expect(said).toMatch(/^The current savings plan doesn't reach financial independence/);
    else if (!w.sustainsToLifeExpectancy) expect(said).toContain(`expenses outpace the corpus around age ${w.shortfallAge}`);
  });
});

describe("prepayinvest — Loan Prepay vs Invest", () => {
  const p0 = { outstanding: 5000000, loanRatePct: 8.5, remainingMonths: 180, surplusMonthly: 20000, investReturnPct: 12 };
  it("prints the web's default case", () => {
    const w = webAd.prepayVsInvest(p0);
    const b = run(DEFS.prepayinvest);
    expect(statOf(b, "Loan EMI")).toBe(`${inr(Math.round(w.emi))}/mo`);
    expect(statOf(b, "Prepay → final corpus")).toBe(inr(Math.round(w.prepayCorpus)));
    expect(statOf(b, "Invest → final corpus")).toBe(inr(Math.round(w.investCorpus)));
    const yrs = Math.round(w.monthsSaved / 12);
    expect(texts(b, "insight")[0]).toBe(
      `${w.winner === "invest" ? "Investing the surplus" : "Prepaying the loan"} wins by ${inrCompact(w.gap)} at the loan’s original end-date. Prepaying still saves ${inrCompact(w.interestSaved)} in interest and closes the loan ${yrs} yr${yrs === 1 ? "" : "s"} early.`,
    );
    expect(texts(b, "insight")[1]).toBe("Prepaying is a guaranteed, risk-free 8.5% return and removes debt stress; investing targets a higher but not guaranteed 12%. The maths favours investing only if returns hold and the client stays the course.");
  });
  it.each([
    { outstanding: 2500000, loanRatePct: 10.5, remainingMonths: 120, surplusMonthly: 15000, investReturnPct: 9 },
    { outstanding: 3000000, loanRatePct: 9, remainingMonths: 240, surplusMonthly: 0, investReturnPct: 9 },
    { outstanding: 400000, loanRatePct: 9, remainingMonths: 24, surplusMonthly: 50000, investReturnPct: 12 },
  ])("prepayVsInvest equals the web module (%#)", (input) => {
    const w = webAd.prepayVsInvest(input);
    expect(appAd.prepayVsInvest(input)).toEqual(w);
    const b = run(DEFS.prepayinvest, {
      outstanding: input.outstanding, loanRate: input.loanRatePct, remainingYears: input.remainingMonths / 12,
      surplus: input.surplusMonthly, investReturn: input.investReturnPct,
    });
    expect(statOf(b, "Prepay → final corpus")).toBe(inr(Math.round(w.prepayCorpus)));
    expect(statOf(b, "Invest → final corpus")).toBe(inr(Math.round(w.investCorpus)));
    const winnerTile = stats(b).find((s) => s.tone === "success")?.label;
    expect(winnerTile).toBe(w.winner === "prepay" ? "Prepay → final corpus" : w.winner === "invest" ? "Invest → final corpus" : undefined);
    if (w.winner === "tie") expect(texts(b, "insight")[0]).toMatch(/^Prepaying and investing end level/);
  });
});

describe("btid — Term + MF vs ULIP / Endowment", () => {
  const p0 = { annualBudget: 100000, termAnnualPremium: 15000, termCover: 10000000, years: 25, mfReturnPct: 12, tradReturnPct: 5.5 };
  it("prints the web's default case", () => {
    const w = webAd.btid(p0);
    const b = run(DEFS.btid);
    expect(statOf(b, "Term + MF — corpus (post-tax)")).toBe(inr(Math.round(w.btidPostTax)));
    expect(statOf(b, "Traditional — corpus")).toBe(inr(Math.round(w.tradPostTax)));
    expect(statOf(b, "Term + MF — cover")).toBe("₹1.00 Cr");
    expect(statOf(b, "Traditional — cover")).toBe("₹10.0 L");
    expect(texts(b, "insight")[0]).toBe(
      `For the same ₹1,00,000/year, Term + MF builds ${inrCompact(w.btidPostTax)} after LTCG with ₹1.00 Cr cover — versus ${inrCompact(w.tradPostTax)} and ₹10.0 L cover from a bundled policy. That’s ${inrCompact(Math.abs(w.wealthGap))} more wealth and ₹90.0 L more protection. Insurance and investment do their jobs best when kept separate.`,
    );
    expect(texts(b, "note")).toEqual(["ULIP maturity tax-free only while the annual premium is ≤ ₹2.5 L."]);
  });
  it.each([
    { annualBudget: 300000, termAnnualPremium: 25000, termCover: 20000000, years: 20, mfReturnPct: 11, tradReturnPct: 6 },
    { annualBudget: 50000, termAnnualPremium: 45000, termCover: 300000, years: 10, mfReturnPct: 8, tradReturnPct: 7 },
  ])("btid equals the web module (%#)", (input) => {
    const w = webAd.btid(input);
    expect(appAd.btid(input)).toEqual(w);
    const b = run(DEFS.btid, {
      annualBudget: input.annualBudget, termPremium: input.termAnnualPremium, termCover: input.termCover, years: input.years,
      mfReturn: input.mfReturnPct, tradReturn: input.tradReturnPct,
    });
    expect(statOf(b, "Term + MF — corpus (post-tax)")).toBe(inr(Math.round(w.btidPostTax)));
    expect(statOf(b, "Traditional — corpus")).toBe(inr(Math.round(w.tradPostTax)));
    expect(texts(b, "insight")[0]).toContain(`${inrCompact(Math.abs(w.wealthGap))} ${w.wealthGap >= 0 ? "more" : "less"} wealth`);
    expect(texts(b, "note")[0]).toBe(w.ulipTaxFree ? "ULIP maturity tax-free only while the annual premium is ≤ ₹2.5 L." : "Premium above ₹2.5 L/yr: ULIP gains taxed as LTCG too.");
  });
});

describe("npsvsmf — NPS vs Mutual Fund", () => {
  it.each([
    { monthly: 10000, years: 25, npsReturnPct: 9, mfReturnPct: 12, annuityRatePct: 6, taxSlabPct: 30 },
    { monthly: 3000, years: 18, npsReturnPct: 10, mfReturnPct: 11, annuityRatePct: 6.5, taxSlabPct: 20 },
    { monthly: 25000, years: 30, npsReturnPct: 8.5, mfReturnPct: 12.5, annuityRatePct: 5.5, taxSlabPct: 5 },
  ])("npsVsMf equals the web module (%#)", (input) => {
    const w = webAd.npsVsMf(input);
    expect(appAd.npsVsMf(input)).toEqual(w);
    const b = run(DEFS.npsvsmf, {
      monthly: input.monthly, years: input.years, npsReturn: input.npsReturnPct, mfReturn: input.mfReturnPct,
      annuityRate: input.annuityRatePct, taxSlab: input.taxSlabPct,
    });
    expect(statOf(b, "NPS corpus @ 60")).toBe(inr(Math.round(w.npsCorpus)));
    expect(statOf(b, "MF corpus @ 60")).toBe(inr(Math.round(w.mfCorpus)));
    expect(statOf(b, "NPS lump (60%)")).toBe(inr(Math.round(w.npsLumpsum)));
    expect(statOf(b, "NPS pension / mo (post-tax)")).toBe(inr(Math.round(w.npsMonthlyPensionPostTax)));
    expect(texts(b, "insight")[0]).toContain(`NPS adds an extra ${inr(Math.round(w.annualNpsTaxSaved))}/yr tax saving via 80CCD(1B)`);
  });
  it("defaults are the web's", () => {
    const b = run(DEFS.npsvsmf);
    const w = webAd.npsVsMf({ monthly: 10000, years: 25, npsReturnPct: 9, mfReturnPct: 12, annuityRatePct: 6, taxSlabPct: 30 });
    expect(statOf(b, "MF corpus @ 60")).toBe(inr(Math.round(w.mfCorpus)));
    expect(texts(b, "insight")[1]).toBe("Illustration only. NPS rules (40% annuity, tax treatment) and annuity rates change; equity-MF gains attract LTCG tax on withdrawal.");
  });
});

describe("housingstrategy — Home-Buying Strategy", () => {
  const p0 = { loan: 25000000, loanRatePct: 9, tenureYears: 20, escalationPct: 6, sipReturnPct: 15, sipGrowthPct: 10, rentYieldPct: 4, rentGrowthPct: 10 };
  it("prints the web's reference case (₹57.61 / 61.42 / 62.79 Cr)", () => {
    // housing-emi-sip.ts: strategies 1–2 match the sheet (₹57.61 / 61.42 Cr); the rent route is 62.79 Cr.
    const w = webHo.housingEmiSip(p0);
    const b = run(DEFS.housingstrategy);
    const tiles = stats(b);
    expect(tiles.slice(0, 3).map((s) => [s.label, s.value])).toEqual([
      ["Pay off loan early", "₹57.61 Cr"],
      ["Keep loan full term", "₹61.42 Cr"],
      ["Rent & buy at the end (best)", "₹62.79 Cr"],
    ]);
    const keep = w.strategies[1];
    expect(tiles[1].hint).toBe(`${Math.abs(keep.incrementalPct * 100).toFixed(0)}% more than paying off early\n≈ ${inrCompact(keep.monthlyIncome)}/mo income for life\n${keep.note}`);
    expect(tiles[0].hint!.split("\n")[0]).toBe("wealth created");
    expect(statOf(b, "Home cost at end of tenure")).toBe(inrCompact(w.houseCostAtEnd));
    expect(statOf(b, "Total rent paid (rent route)")).toBe(inrCompact(w.totalRentPaid));
    expect(statOf(b, "Loan cleared early in")).toBe(`${w.loanOverYear} yrs`);
    expect(texts(b, "insight")[0]).toBe(`Monthly outgo across all three: ${inr(Math.round(w.emiMonthly * 2))}/mo in year 1 (EMI ${inr(Math.round(w.emiMonthly))} + SIP of the same, stepping up 10%/yr)`);
    const best = w.strategies[2];
    expect(texts(b, "insight")[1]).toBe(`On the same cashflow, rent & buy at the end builds the most — ${inrCompact(best.wealth)} (${Math.abs(best.incrementalPct * 100).toFixed(0)}% more than paying the loan off early), worth ~${inrCompact(best.monthlyIncome)}/month of income for life — equity at 15% against a 9% loan.`);
  });
  it.each([
    { ...p0, loan: 8000000, loanRatePct: 8.5, tenureYears: 15, sipReturnPct: 12, rentYieldPct: 3 },
    { ...p0, loanRatePct: 11, sipReturnPct: 9, sipGrowthPct: 5, rentGrowthPct: 6 },
  ])("housingEmiSip equals the web module (%#)", (input) => {
    const w = webHo.housingEmiSip(input);
    expect(appHo.housingEmiSip(input)).toEqual(w);
    const b = run(DEFS.housingstrategy, {
      loan: input.loan, loanRate: input.loanRatePct, tenure: input.tenureYears, escalation: input.escalationPct,
      sipReturn: input.sipReturnPct, sipGrowth: input.sipGrowthPct, rentYield: input.rentYieldPct, rentGrowth: input.rentGrowthPct,
    });
    const tiles = stats(b).slice(0, 3);
    expect(tiles.map((s) => s.value)).toEqual(w.strategies.map((s) => inrCompact(s.wealth)));
    expect(tiles.filter((s) => s.label.endsWith("(best)")).map((s) => s.label)).toEqual([`${w.strategies.find((s) => s.key === w.bestKey)!.label} (best)`]);
  });
});
