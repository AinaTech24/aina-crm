/**
 * Test-only helpers for the calculator defs: run a def on its defaults (plus
 * overrides) and read a stat / table back by label.
 */

import type { CalcBody, CalcContext, ResultBlock } from "../types";

export function defaults(body: CalcBody): Record<string, any> {
  const v: Record<string, any> = {};
  for (const i of body.inputs) v[i.key] = i.default;
  return v;
}

export function run(body: CalcBody, overrides: Record<string, any> = {}, ctx: CalcContext = { nav: {} }): ResultBlock[] {
  return body.compute({ ...defaults(body), ...overrides }, ctx);
}

/** The value of the stat whose label equals (or, given a RegExp, matches) `label`. */
export function statOf(blocks: ResultBlock[], label: string | RegExp): string | undefined {
  const b = blocks.find((x) => x.type === "stat" && (typeof label === "string" ? x.label === label : label.test(x.label)));
  return b && b.type === "stat" ? b.value : undefined;
}

export function tables(blocks: ResultBlock[]): Array<{ head: string[]; rows: string[][] }> {
  return blocks.flatMap((b) => (b.type === "table" ? [{ head: b.head, rows: b.rows }] : []));
}
