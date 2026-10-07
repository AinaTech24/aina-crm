/**
 * Field checks for the fact-find form — PAN, mobile, email, date of birth and
 * no negative amounts. Pure, so the RM form and the client's link show the
 * same messages. A masked value (the client link hides PAN and mobile) is the
 * stored one and is not checked.
 *
 * Keys are "section.field" for identity and "list.row.field" for the lists, so
 * the form can put each message beside its box.
 */

import type { DiscoveryData } from "./calc";

export type DiscoveryErrors = Record<string, string>;

const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const masked = (v: string) => v.includes("*");

function indiaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Indian mobile: 10 digits starting 6–9, with an optional +91 / 0 prefix. */
export function validMobile(v: string): boolean {
  const d = v.replace(/[\s\-()]/g, "").replace(/^(\+?91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(d);
}

const MONEY_LISTS: Record<string, string[]> = {
  income: ["amount", "annualAmount"],
  assets: ["currentValue", "invested"],
  liabilities: ["outstanding", "emi", "ratePct"],
  lifeInsurance: ["sumAssured", "premium"],
  healthInsurance: ["sumInsured", "premium"],
  goals: ["targetCorpus", "alreadySaved"],
};

export function checkDiscovery(d: DiscoveryData, opts?: { today?: string }): DiscoveryErrors {
  const e: DiscoveryErrors = {};
  const id = (d.identification ?? {}) as Record<string, unknown>;

  const pan = str(id.pan).toUpperCase();
  if (pan && !masked(pan) && !PAN_RX.test(pan)) e["identification.pan"] = "PAN looks wrong — 5 letters, 4 digits, 1 letter";

  const mobile = str(id.mobile);
  if (mobile && !masked(mobile) && !validMobile(mobile)) e["identification.mobile"] = "Enter a 10-digit mobile number";

  const email = str(id.email);
  if (email && !EMAIL_RX.test(email)) e["identification.email"] = "Enter a valid email";

  const dob = str(id.dob);
  if (dob) {
    const today = opts?.today ?? indiaToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) e["identification.dob"] = "Enter a valid date";
    else if (dob > today) e["identification.dob"] = "Date of birth is in the future";
    else if (Number(today.slice(0, 4)) - Number(dob.slice(0, 4)) > 110) e["identification.dob"] = "Check the year";
  }

  const dep = str(id.dependents);
  if (dep && (!/^\d+$/.test(dep) || Number(dep) > 20)) e["identification.dependents"] = "Enter a whole number";

  for (const [k, v] of Object.entries(d.expenses ?? {})) {
    if (Number(v) < 0) e[`expenses.${k}`] = "Cannot be negative";
  }
  for (const k of ["estimatedTax", "annualLoanEmis", "annualInsurancePremiums"] as const) {
    if (Number((d.surplusInputs as any)?.[k]) < 0) e[`surplusInputs.${k}`] = "Cannot be negative";
  }
  for (const [list, fields] of Object.entries(MONEY_LISTS)) {
    const rows = ((d as any)[list] ?? []) as Record<string, unknown>[];
    rows.forEach((r, i) => {
      for (const f of fields) if (Number(r?.[f]) < 0) e[`${list}.${i}.${f}`] = "Cannot be negative";
    });
  }
  (d.goals ?? []).forEach((g, i) => {
    const y = str(g?.targetYear);
    if (y && (!/^\d{4}$/.test(y) || Number(y) < 1950 || Number(y) > 2150)) e[`goals.${i}.targetYear`] = "Enter a year, e.g. 2035";
  });
  return e;
}
