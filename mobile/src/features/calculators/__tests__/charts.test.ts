/**
 * The growth charts under calculator results (chart.ts + every def that
 * declares one): each chart a def builds on its defaults is drawable — rising
 * x, finite points, one value per x — and reads the same figures as the
 * result's own tiles. Plus the pure scale / label helpers GrowthChart draws from.
 */

import { CALCULATORS } from "../registry";
import { inr } from "../fmt";
import { resultsToText } from "../share";
import { axisInr, chartBlock, chartSummary, cumulative, MAX_LINES, niceTicks, spreadLabels, xTickIndexes, lineColors, CHART_COLORS } from "../chart";
import type { CalculatorDef, ChartSpec, ResultBlock } from "../types";

const defaultsOf = (d: CalculatorDef): Record<string, any> => Object.fromEntries(d.inputs.map((i) => [i.key, i.default]));
const run = (d: CalculatorDef): ResultBlock[] => d.compute(defaultsOf(d), { nav: {} });
const chartsOf = (b: ResultBlock[]): ChartSpec[] => b.flatMap((x) => (x.type === "chart" ? [x.chart] : []));

/** The calculators that must show a chart on their defaults — SIP & Wealth,
 *  Goals & Planning, retirement / income, and every other def with a series. */
const MUST_CHART = [
  // SIP & Wealth Building
  "reckoner", "growing", "salary", "fvannual", "annualreq", "sip", "lumpsumfv", "sipfv", "stepupfv", "limitedfv", "sipstp", "compounding",
  // Goals & Planning
  "multipurpose", "vacation", "childsip", "collision", "delay", "retirement", "limitedneed", "stepuptarget", "siplstarget", "lstarget",
  "sipstpgoal", "stpgoal", "ppf", "epf",
  // Retirement & income
  "bridge", "swpperiodic", "swpend", "swpcomp", "stpcomp", "opm", "swp", "stp", "prosperity", "swpneed", "sipforswp", "swprebal", "sipswp",
  "moneylast", "journey",
  // Other value-over-time results
  "insurance", "loanemi", "expensedrag", "portproj", "crash", "doubling",
];

// Fund Research needs live NAVs and draws no chart.
const OFFLINE = CALCULATORS.filter((d) => d.group !== "Fund Research");

describe("every chart-declaring calculator", () => {
  it("covers the SIP, goal and retirement families", () => {
    const charted = OFFLINE.filter((d) => chartsOf(run(d)).length > 0).map((d) => d.key);
    expect(charted).toEqual(expect.arrayContaining(MUST_CHART));
  });

  it.each(OFFLINE.map((d) => [d.key, d] as const))("%s: its chart has finite points for the defaults", (_key, d) => {
    for (const c of chartsOf(run(d))) {
      expect(c.x.length).toBeGreaterThanOrEqual(2);
      c.x.forEach((x, i) => {
        expect(Number.isFinite(x)).toBe(true);
        if (i > 0) expect(x).toBeGreaterThan(c.x[i - 1]);
      });
      expect(c.lines.length).toBeGreaterThan(0);
      expect(c.lines.length).toBeLessThanOrEqual(MAX_LINES);
      expect(c.lines.some((l) => l.role === "value")).toBe(true);
      for (const l of c.lines) {
        expect(l.values).toHaveLength(c.x.length);
        for (const y of l.values) expect(Number.isFinite(y)).toBe(true);
      }
      expect(chartSummary(c)).not.toMatch(/NaN|undefined|Infinity|— at /);
    }
  });

  it("an Invested line ends on the result's own Total invested", () => {
    let checked = 0;
    for (const d of OFFLINE) {
      const b = run(d);
      const total = b.find((x) => x.type === "stat" && x.label === "Total invested");
      for (const c of chartsOf(b)) {
        const inv = c.lines.find((l) => l.label === "Invested");
        if (!inv || !total || total.type !== "stat") continue;
        expect([d.key, inr(inv.values[inv.values.length - 1])]).toEqual([d.key, total.value]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it("the WhatsApp text is unchanged by a chart", () => {
    // Tables already hold the figures; a chart block has no text form.
    const d = CALCULATORS.find((c) => c.key === "sipfv")!;
    const b = run(d);
    expect(b.some((x) => x.type === "chart")).toBe(true);
    expect(resultsToText(d.name, "Firm", b)).toBe(resultsToText(d.name, "Firm", b.filter((x) => x.type !== "chart")));
  });
});

describe("chartBlock", () => {
  const ok = { label: "Value", values: [1, 2, 3] };
  it("builds one block for a drawable series", () => {
    expect(chartBlock("Year", [1, 2, 3], [ok])).toEqual([{ type: "chart", chart: { xLabel: "Year", x: [1, 2, 3], lines: [{ ...ok, role: "value" }] } }]);
  });
  it("drops what it cannot draw honestly", () => {
    expect(chartBlock("Year", [1], [{ label: "V", values: [1] }])).toEqual([]);
    expect(chartBlock("Year", [1, 1, 2], [ok])).toEqual([]);
    expect(chartBlock("Year", [1, 2, 3], [{ label: "V", values: [1, 2] }])).toEqual([]);
    expect(chartBlock("Year", [1, 2, 3], [{ label: "V", values: [1, NaN, 3] }])).toEqual([]);
    expect(chartBlock("Year", [1, 2, 3], [{ label: "V", values: [0, 0, 0] }])).toEqual([]);
    expect(chartBlock("Year", [1, 2, 3], [{ label: "In", role: "invested", values: [1, 2, 3] }])).toEqual([]);
  });
  it("leaves out an all-zero line and caps the line count", () => {
    const [b] = chartBlock("Year", [1, 2], [ok, ok, { label: "Zero", values: [0, 0] }, ok, ok, ok].map((l) => ({ ...l, values: l.values.slice(0, 2) })));
    expect(b.type === "chart" && b.chart.lines.map((l) => l.label)).toEqual(["Value", "Value", "Value", "Value"]);
  });
});

describe("axis helpers", () => {
  it("labels rupees the Indian way", () => {
    expect(axisInr(0)).toBe("₹0");
    expect(axisInr(850)).toBe("₹850");
    expect(axisInr(45000)).toBe("₹45k");
    expect(axisInr(1250000)).toBe("₹12.5 L");
    expect(axisInr(100000)).toBe("₹1 L");
    expect(axisInr(12500000)).toBe("₹1.25 Cr");
    expect(axisInr(300000000)).toBe("₹30 Cr");
    expect(axisInr(-250000)).toBe("-₹2.5 L");
  });
  it("ticks span the data from a round floor to a round ceiling", () => {
    const t = niceTicks(0, 4759314);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(4759314);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.length).toBeLessThanOrEqual(7);
    const neg = niceTicks(-120, 900);
    expect(neg[0]).toBeLessThanOrEqual(-120);
    expect(neg).toContain(0);
  });
  it("labels the first and the last x", () => {
    expect(xTickIndexes(30, 5)).toEqual([0, 7, 15, 22, 29]);
    expect(xTickIndexes(3, 5)).toEqual([0, 1, 2]);
  });
  it("keeps end labels apart and inside the plot", () => {
    const y = spreadLabels([50, 52, 51], 14, 0, 200);
    const sorted = [...y].sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(14);
    expect(sorted[2] - sorted[1]).toBeGreaterThanOrEqual(14);
    expect(spreadLabels([199, 200], 14, 0, 200).every((v) => v <= 200)).toBe(true);
  });
  it("colours value lines from the palette and invested lines slate", () => {
    expect(lineColors([{ label: "I", role: "invested", values: [] }, { label: "V", role: "value", values: [] }]))
      .toEqual([CHART_COLORS.invested[0], CHART_COLORS.value[0]]);
  });
  it("runs a cumulative total", () => {
    expect(cumulative([1, 2, 3])).toEqual([1, 3, 6]);
  });
});
