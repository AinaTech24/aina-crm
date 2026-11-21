/**
 * The calculator registry: every catalog entry (catalog.ts — the web's groups,
 * keys and names, in the web's order) paired with its def from ./defs. The
 * gallery and the [key] screen are generated from CALCULATORS — adding a
 * calculator means adding its body to a defs file, nothing else.
 *
 * Every compute runs the web CRM's own maths (./web, copied verbatim), so a
 * figure here equals the CRM's to the rupee.
 */

import { CATALOG } from "./catalog";
import type { CalcBody, CalculatorDef } from "./types";
import { DEFS as SIP_WEALTH } from "./defs/sipWealth";
import { DEFS as RECKONERS } from "./defs/reckoners";
import { DEFS as GOALS } from "./defs/goals";
import { DEFS as INCOME } from "./defs/income";
import { DEFS as INSURANCE_TAX } from "./defs/insuranceTax";
import { DEFS as PROPERTY_CONVERSION } from "./defs/propertyConversion";
import { DEFS as DECISIONS } from "./defs/decisions";
import { DEFS as ADVISOR } from "./defs/advisor";
import { DEFS as LIFESTYLE } from "./defs/lifestyle";
import { DEFS as FUND_RESEARCH } from "./defs/fundResearch";

const BODIES: Record<string, CalcBody> = {
  ...SIP_WEALTH, ...RECKONERS, ...GOALS, ...INCOME, ...INSURANCE_TAX, ...PROPERTY_CONVERSION,
  ...DECISIONS, ...ADVISOR, ...LIFESTYLE, ...FUND_RESEARCH,
};

export const CALCULATORS: CalculatorDef[] = CATALOG.flatMap((g) =>
  g.items.flatMap((it) => {
    const body = BODIES[it.key];
    return body ? [{ ...it, group: g.title, ...body }] : [];
  }),
);

export const CALC_GROUPS: string[] = CATALOG.map((g) => g.title).filter((t) => CALCULATORS.some((c) => c.group === t));

export const calcByKey = (key: string): CalculatorDef | undefined => CALCULATORS.find((c) => c.key === key);

/** Catalog keys with no def yet (the web has them, the app does not). */
export const NOT_PORTED: string[] = CATALOG.flatMap((g) => g.items.map((i) => i.key)).filter((k) => !BODIES[k]);
