/**
 * Investment Options' WealthMaker insurance export (2026-11-24): four sheets —
 * Floater, Individual (health, one row per insured member), Motor and Other —
 * 2022 to 2026, each year's renewal under its own policy number.
 *
 * The export has no PAN and no mobile, so a policy is linked to a client ONLY
 * when the holder's name matches exactly one live client (`nameMatchKey`: any
 * word order, honorifics dropped, two words at least). Anything else is skipped
 * and listed, never guessed (the user's choice).
 *
 * A policy number already in the CRM (the Zoho import) is not added again; it
 * only has its blanks filled from WealthMaker (vehicle, IDV, members).
 *
 * History: a policy whose period ended and that the client renewed (a later
 * policy of the same type for the same client starting by 60 days after its
 * expiry) is "matured" — its term ran out, it was not lost. One with no such
 * successor is "lapsed" once the 30-day grace is over, as at the Zoho import.
 * Nothing alerts for either.
 */

import { cell, isoDate } from "../values";
import { num } from "../modules";
import { insurerName, personEmail, policyTypeOf, type PolicyType } from "./modules";
import { na } from "./contacts";

export type WmSheet = "Floater" | "Individual" | "Motor" | "Other";
export type WmRow = Record<string, unknown> & { _sheet?: string };

export type WmPolicy = {
  sheet: WmSheet;
  policyNumber: string;
  holder: string;
  insurer: string;
  planName: string;
  policyType: PolicyType;
  sumAssured: number | null;
  premium: number | null;
  startDate: string | null;
  expiryDate: string | null;
  livesCovered: number | null;
  agencyEmail: string;
  details: Record<string, unknown>;
};

/** WealthMaker's product names → the CRM's type, before the shared rules (which read "Star" as health). */
const WM_TYPES: Array<[RegExp, PolicyType]> = [
  [/group (mediclaim|medical|medicare|care|health)|\bgmc\b/i, "group_health"],
  [/group personal accident|personal accident policy- ?group|\bgpa\b/i, "group_personal_accident"],
  [/critical illness/i, "critical_illness"],
  [/top ?up|diabetes|mediclaim|health/i, "health"],
  [/workm[ae]n|employees? compensation/i, "workmen_comp"],
  [/marine/i, "marine"],
  [/travel/i, "travel"],
  [/burglary/i, "burglary"],
  [/griha raksha|my home|householder|home insurance/i, "home"],
  [/personal guard|personal accident|accident|nagarik suraksha|sankat mochan|pradhan mantri suraksha|sarva suraksha/i, "personal_accident"],
  [/fire|special perils|special peris|udyam suraksha|commercial property|consequential loss|package|shopkeeper|business guard|jeweller/i, "fire"],
  [/cyber|indemnity|liability|negligence|credit|money insurance|fidelity|contractors? all risk|construction all risk|plate glass|contingency|customi[sz]ed/i, "general_other"],
];

export function wmPolicyType(sheet: WmSheet, product: string): PolicyType {
  if (sheet === "Motor") return "motor";
  if (sheet === "Floater" || sheet === "Individual") {
    if (/group/i.test(product)) return "group_health";
    if (/critical/i.test(product)) return "critical_illness";
    return "health";
  }
  for (const [re, t] of WM_TYPES) if (re.test(product)) return t;
  return policyTypeOf(product);
}

const WM_INSURERS: Array<[RegExp, string]> = [
  [/^indusind/i, "IndusInd General Insurance"],
  [/^birla|^aditya/i, "Aditya Birla Health Insurance"],
  [/^raheja/i, "Raheja QBE General Insurance"],
  [/^uni(versal)?\.? ?sompo/i, "Universal Sompo General Insurance"],
  [/^zurich kotak|^kotak/i, "Zurich Kotak General Insurance"],
  [/^acko/i, "Acko General Insurance"],
  [/^kiwi/i, "Kiwi General Insurance"],
  [/^shriram/i, "Shriram General Insurance"],
  [/^magma/i, "Magma General Insurance"],
];
export function wmInsurer(v: string): string {
  const s = na(v);
  for (const [re, name] of WM_INSURERS) if (re.test(s)) return name;
  return insurerName(s);
}

/** Agency codes the firm's people used in WealthMaker. */
const AGENCY: Record<string, string> = { h: "harshad", j: "jugal" };

const amount = (v: unknown) => (num(v) > 0 ? num(v) : undefined);
const text = (v: unknown) => na(v) || undefined;
const day = (v: unknown) => isoDate(na(v)) ?? undefined;

function prune(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)));
}

const sheetOf = (r: WmRow): WmSheet => {
  const s = cell(r._sheet);
  return s === "Floater" || s === "Individual" || s === "Motor" ? s : "Other";
};

const coverOf = (v: string) => (!v ? undefined : /package|comp/i.test(v) ? "comprehensive" : /liab|third|tp/i.test(v) ? "third_party" : /own damage|\bod\b/i.test(v) ? "od_only" : v);

/** One policy from its rows (a health policy has one row per insured member). */
export function mapWmPolicy(rows: WmRow[]): WmPolicy {
  const r = rows[0];
  const sheet = sheetOf(r);
  const motor = sheet === "Motor";
  const health = sheet === "Floater" || sheet === "Individual";
  const product = na(r.Product);
  const plan = na(r.Plan);
  const holder = na(motor ? r.Name : r["Name of Policy Holder"]);
  const members = health
    ? rows
        .map((x) =>
          prune({
            name: text(x["Member Name"]),
            gender: text(x["Member Gender"]),
            dob: day(x["Member DOB"]),
            sumInsured: sheet === "Individual" && num(x.Sum) > 0 ? String(num(x.Sum)) : undefined,
            premium: sheet === "Individual" && num(x.Premium) > 0 ? String(num(x.Premium)) : undefined,
          }),
        )
        .filter((m) => Object.keys(m).length > 0)
    : [];
  const sum =
    sheet === "Floater" ? num(r["Floater Sum"]) :
    sheet === "Individual" ? rows.reduce((s, x) => s + num(x.Sum), 0) :
    motor ? num(r.IDV) :
    num(r.Sum);
  const premium =
    sheet === "Individual" ? (num(r["Gross Premium"]) || rows.reduce((s, x) => s + num(x.Premium), 0) || num(r["Basic Premium"])) :
    motor ? num(r.Premium) :
    num(r["Gross Premium"]) || num(r.Premium) || num(r["Basic Premium"]);
  const agency = na(r["Agency Code"]);
  const addOns = rows.map((x) => na(x["AddOn Name"])).filter(Boolean);
  const details = prune({
    source: "wealthmaker",
    wmSheet: sheet,
    wmProduct: product || undefined,
    agencyCode: agency || undefined,
    previousPolicyNo: text(r["Prev Policy No"]),
    basicPremium: amount(r["Basic Premium"]),
    paymentMode: text(r["Payment Mode"]),
    paymentDate: day(r["Payment Date"]),
    zone: text(r.Zone),
    // Health
    familyFloater: sheet === "Floater" ? true : undefined,
    insuredMembers: members.length ? members : undefined,
    coPayPercent: amount(r["CoPay Percentage"]),
    tpa: text(r.TPA),
    // Motor
    coverType: motor ? coverOf(na(r["Policy Type"])) : undefined,
    vehicleType: motor ? text(r["Policy Sub Type"]) : undefined,
    makeModel: motor ? text(r["Vehicle Name"]) : undefined,
    cubicCapacity: motor ? amount(r.CC) : undefined,
    seatingCapacity: motor ? amount(r["Seating Capacity"]) : undefined,
    manufacturingYear: motor ? amount(r["Year of Manufacture"]) : undefined,
    vehicleRegNo: motor ? text(r["Registration No"]) : undefined,
    engineNo: motor ? text(r["Engine No"]) : undefined,
    chassisNo: motor ? text(r["Chassis No"]) : undefined,
    ncbPercent: motor ? amount(r["NCB Rate"]) : undefined,
    odPremium: motor ? amount(r["Total OD Premium"]) : undefined,
    tpPremium: motor ? amount(r["Total Liability Premium"]) : undefined,
    cngKitPremium: motor ? amount(r["CNG Premium"]) : undefined,
    paOwnerDriver: motor && num(r["PA to Owner Driver Loadin"]) > 0 ? true : undefined,
    addOnNames: addOns.length ? addOns.join(", ") : undefined,
  });
  return {
    sheet,
    policyNumber: na(r["Policy No"]),
    holder,
    insurer: wmInsurer(cell(r.Insurer)),
    planName: ([product, plan].filter(Boolean).join(" — ") || "Policy").slice(0, 300),
    policyType: wmPolicyType(sheet, product),
    sumAssured: sum > 0 ? sum : null,
    premium: premium > 0 ? premium : null,
    startDate: isoDate(na(r["Start Date"])) ?? null,
    expiryDate: isoDate(na(r["Expiry Date"])) ?? null,
    livesCovered: members.length > 1 ? members.length : null,
    agencyEmail: AGENCY[agency.toLowerCase()] ? personEmail(AGENCY[agency.toLowerCase()]) : "",
    details,
  };
}

/** A policy number as compared across the CRM: case and spaces ignored. */
export const policyKey = (v: string | null | undefined) => String(v ?? "").toUpperCase().replace(/\s+/g, "");

/** The file's rows grouped into policies (by sheet + policy number), in file order. */
export function groupWmRows(rows: WmRow[]): WmRow[][] {
  const groups = new Map<string, WmRow[]>();
  for (const r of rows) {
    const no = policyKey(na(r["Policy No"]));
    if (!no) continue;
    const k = `${sheetOf(r)}|${no}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.values()];
}

const DAY = 864e5;
const t = (d: string) => new Date(`${d}T00:00:00+05:30`).getTime();

/**
 * Status for a policy given its client's other policies: in its period (or the
 * 30-day grace) → active; over and followed by a policy of the same type that
 * starts within 60 days of its expiry → matured (renewed); over with none → lapsed.
 */
export function wmStatus(
  p: { expiryDate: string | null; policyType: string; startDate: string | null },
  others: Array<{ policyType: string; startDate: string | null; policyNumber: string }>,
  today: string,
): { status: "active" | "matured" | "lapsed"; renewedBy?: string } {
  if (!p.expiryDate || t(p.expiryDate) + 30 * DAY >= t(today)) return { status: "active" };
  const next = others.find(
    (o) =>
      o.policyType === p.policyType &&
      o.startDate &&
      p.startDate &&
      t(o.startDate) > t(p.startDate) &&
      t(o.startDate) <= t(p.expiryDate!) + 60 * DAY,
  );
  return next ? { status: "matured", renewedBy: next.policyNumber } : { status: "lapsed" };
}
