/**
 * Input builders and small helpers shared by the defs files, so the same web
 * control (e.g. "Return, scenario 1 / Compare scenario 2") reads the same in
 * every calculator.
 */

import type { InputSpec, ResultBlock, Tone } from "../types";
import { scenarioRates } from "../web/sip-suite";

/** The web's ScenarioFields: return 1, "Compare scenario 2" toggle, return 2. */
export function scenarioInputs(r1 = 12, r2 = 15, useR2 = true, labels = { r1: "Return, scenario 1", r2: "Return, scenario 2" }): InputSpec[] {
  return [
    { key: "r1", label: labels.r1, type: "percent", default: r1 },
    { key: "useR2", label: "Compare scenario 2", type: "toggle", default: useR2 },
    { key: "r2", label: labels.r2, type: "percent", default: r2, visibleIf: (v) => !!v.useR2 },
  ];
}

/** The rates the scenario inputs describe (web scenarioRates). */
export function ratesOf(v: Record<string, any>): number[] {
  return scenarioRates(Number(v.r1) || 0, v.useR2 ? Number(v.r2) || 0 : null);
}

/** The web's "Summary / Year-wise detail" report switch. */
export const reportInput = (dflt: "summary" | "detailed" = "detailed"): InputSpec => ({
  key: "view", label: "Report", type: "segmented", default: dflt,
  options: [{ value: "summary", label: "Summary" }, { value: "detailed", label: "Year-wise detail" }],
});

/** Web stat tones → app tones. */
export const TONE: Record<"cyan" | "emerald" | "amber" | "rose", Tone> = {
  cyan: "brand", emerald: "success", amber: "warning", rose: "danger",
};

export const stat = (label: string, value: string, tone?: Tone, hint?: string): ResultBlock => ({ type: "stat", label, value, tone, hint });
export const section = (text: string): ResultBlock => ({ type: "section", text });
export const table = (head: string[], rows: string[][], highlightLast = false): ResultBlock => ({ type: "table", head, rows, highlightLast });
export const insight = (text: string, tone?: Tone): ResultBlock => ({ type: "insight", text, tone });
export const note = (text: string): ResultBlock => ({ type: "note", text });

/** A segmented / select option list from [value, label] pairs. */
export const opts = (pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));
