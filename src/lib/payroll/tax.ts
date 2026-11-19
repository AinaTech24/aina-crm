/**
 * Tax declarations and proofs (tax_declarations, migration 0273;
 * docs/PAYROLL_MODULE_DESIGN.md §3.6). Pure — the employee's form previews it
 * live, and calc.ts uses it for TDS.
 *
 * - The employee picks the regime for the year and declares annual amounts.
 *   The new regime allows almost nothing (standard deduction only), so the
 *   items below count only under the old one; income from a previous employer
 *   this year counts under both.
 * - Until the proof deadline (a firm setting, January by default) TDS uses
 *   what was DECLARED. From the month after it, only what payroll VERIFIED
 *   counts — an item with no verified proof is taken as nil, so the tax
 *   catches up in February and March.
 * - Caps are the Income-tax Act's (old regime), dated with the regime in
 *   statutory.ts. Confirm with the firm's CA.
 */

import { z } from "zod";

export type TaxRegimeKey = "new" | "old";

const amt = z.number().min(0).max(100_000_000).optional();

export const DeclarationSchema = z.object({
  rentPaid: amt,
  metro: z.boolean().optional(),
  landlordName: z.string().trim().max(120).optional(),
  landlordPan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Landlord PAN looks wrong").optional().or(z.literal("")),
  sec80c: amt,
  sec80dSelf: amt,
  sec80dParents: amt,
  seniorSelf: z.boolean().optional(),
  seniorParents: z.boolean().optional(),
  homeLoanInterest: amt,
  nps80ccd1b: amt,
  otherDeductions: amt,
  prevIncome: amt,
  prevTds: amt,
});
export type Declaration = z.infer<typeof DeclarationSchema>;

/** Items that need a proof, in form order. */
export const PROOF_ITEMS = [
  { key: "rentPaid", label: "Rent paid (HRA)", hint: "Rent receipts or the rent agreement. Above ₹1 lakh a year, the landlord's PAN." },
  { key: "sec80c", label: "80C — PF, PPF, ELSS, life insurance, tuition fees, home-loan principal", hint: "Up to ₹1,50,000. Your PF deducted here counts automatically — enter the rest." },
  { key: "sec80dSelf", label: "80D — health insurance, self and family", hint: "Up to ₹25,000 (₹50,000 if you are 60 or older)." },
  { key: "sec80dParents", label: "80D — health insurance, parents", hint: "Up to ₹25,000 (₹50,000 if a parent is 60 or older)." },
  { key: "homeLoanInterest", label: "Home-loan interest, house you live in — 24(b)", hint: "Up to ₹2,00,000. The lender's interest certificate." },
  { key: "nps80ccd1b", label: "80CCD(1B) — your own NPS contribution", hint: "Up to ₹50,000, over and above 80C." },
  { key: "otherDeductions", label: "Other deductions (80E education loan, 80G donations, 80TTA…)", hint: "The total; keep the receipts." },
] as const;
export type ProofKey = (typeof PROOF_ITEMS)[number]["key"];

export type ProofStatus = "submitted" | "verified" | "rejected";
export type Proof = { status: ProofStatus; amount?: number; note?: string };
export type Proofs = Partial<Record<ProofKey, Proof>>;

export const ProofsSchema = z.record(
  z.enum(PROOF_ITEMS.map((p) => p.key) as [ProofKey, ...ProofKey[]]),
  z.object({ status: z.enum(["submitted", "verified", "rejected"]), amount: z.number().min(0).max(100_000_000).optional(), note: z.string().trim().max(300).optional() })
);

export function readDeclaration(raw: unknown): Declaration {
  const p = DeclarationSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  return p.success ? p.data : {};
}
export function readProofs(raw: unknown): Proofs {
  const p = ProofsSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  return p.success ? (p.data as Proofs) : {};
}

/** True when `period` (yyyy-mm-01) falls after the proof deadline month — then only verified proofs count. */
export function proofsApply(period: string, deadlineMonth: number): boolean {
  const m = Number(period.slice(5, 7));
  return m >= 1 && m <= 3 && m > deadlineMonth;
}

/** The amounts TDS uses: declared, or — after the deadline — only what was verified. */
export function effectiveDeclaration(d: Declaration, proofs: Proofs, useProofs: boolean): Declaration {
  if (!useProofs) return d;
  const out: Declaration = { ...d };
  for (const it of PROOF_ITEMS) {
    const p = proofs[it.key];
    out[it.key] = p?.status === "verified" ? (p.amount ?? d[it.key] ?? 0) : 0;
  }
  return out;
}

export type TaxInput = {
  regime: TaxRegimeKey;
  declaration: Declaration;
  /** Proof deadline passed — the declaration shown is already the verified one. */
  proofsApplied: boolean;
};

export type ExemptLine = { label: string; amount: number; why: string };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * What the old regime takes off the year's salary (besides the standard
 * deduction). `annualBasic` / `annualHra` are the year's salary at the current
 * structure; `annualPt` the year's Professional Tax; `annualPf` the employee's
 * PF, which counts inside 80C.
 */
export function oldRegimeDeductions(
  d: Declaration,
  x: { annualBasic: number; annualHra: number; annualPt: number; annualPf: number }
): ExemptLine[] {
  const lines: ExemptLine[] = [];
  const rent = d.rentPaid ?? 0;
  if (rent > 0 && x.annualHra > 0) {
    const share = d.metro ? 0.5 : 0.4;
    const a = x.annualHra;
    const b = Math.max(0, rent - 0.1 * x.annualBasic);
    const c = share * x.annualBasic;
    const hra = Math.round(Math.min(a, b, c));
    if (hra > 0) lines.push({ label: "HRA exemption", amount: hra, why: `Least of HRA ${inr(a)}, rent ${inr(rent)} less 10% of Basic, and ${share * 100}% of Basic ${inr(x.annualBasic)} (${d.metro ? "metro" : "non-metro"})` });
  }
  if (x.annualPt > 0) lines.push({ label: "Professional Tax", amount: Math.min(2500, Math.round(x.annualPt)), why: "Professional Tax for the year (up to ₹2,500)" });
  const c80 = Math.min(150000, (d.sec80c ?? 0) + x.annualPf);
  if (c80 > 0) lines.push({ label: "80C", amount: Math.round(c80), why: `Declared ${inr(d.sec80c ?? 0)} + your PF ${inr(x.annualPf)}, up to ₹1,50,000` });
  const dSelf = Math.min(d.seniorSelf ? 50000 : 25000, d.sec80dSelf ?? 0);
  const dPar = Math.min(d.seniorParents ? 50000 : 25000, d.sec80dParents ?? 0);
  if (dSelf + dPar > 0) lines.push({ label: "80D health insurance", amount: dSelf + dPar, why: `Self and family ${inr(dSelf)}, parents ${inr(dPar)} (within the limits)` });
  const hl = Math.min(200000, d.homeLoanInterest ?? 0);
  if (hl > 0) lines.push({ label: "Home-loan interest 24(b)", amount: hl, why: "Self-occupied house, up to ₹2,00,000" });
  const nps = Math.min(50000, d.nps80ccd1b ?? 0);
  if (nps > 0) lines.push({ label: "80CCD(1B) NPS", amount: nps, why: "Own NPS contribution, up to ₹50,000" });
  if ((d.otherDeductions ?? 0) > 0) lines.push({ label: "Other deductions", amount: Math.round(d.otherDeductions!), why: "As declared" });
  return lines;
}

/** Things worth telling the employee about their declaration (not errors). */
export function declarationWarnings(d: Declaration, regime: TaxRegimeKey): string[] {
  const w: string[] = [];
  if (regime === "old" && (d.rentPaid ?? 0) > 100000 && !d.landlordPan) w.push("Rent above ₹1 lakh a year needs the landlord's PAN for the HRA exemption.");
  if (regime === "new" && PROOF_ITEMS.some((p) => (d[p.key] ?? 0) > 0)) w.push("Under the new regime these deductions do not reduce your tax — choose the old regime if they are worth more to you.");
  return w;
}
