/**
 * The GST tax invoice's arithmetic and wording — pure, so the issuer, the PDF,
 * the page and the tests share one answer (owner's addition E, 2026-11-18).
 *
 *  - Number: AINA/<FY>/<6-digit sequence>, gap-free per India financial year
 *    (the sequence is allocated by lib/billing/invoice.ts under a row lock).
 *  - Tax: CGST 9% + SGST 9% when the place of supply is the supplier's own
 *    state (Gujarat), else IGST 18%. The two halves always sum to the GST total.
 *  - Place of supply: the recipient's state on record; with none on record, the
 *    supplier's location (IGST Act s.12(2)(b) — have the CA confirm).
 */

import type { CycleQuote, LateCharge } from "./aum-pricing";
import { cycleLabel } from "./aum-pricing";
import type { InvoiceLine } from "@/db/schema/billing";
import { istDayNumber } from "./renewal";

/** India financial year of an instant: April–March, "2026-27". */
export function financialYear(d: Date): string {
  const ist = new Date(istDayNumber(d) * 86_400_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function invoiceNumber(prefix: string, fy: string, seq: number): string {
  return `${prefix}/${fy}/${String(seq).padStart(6, "0")}`;
}

export function splitGst(
  gstPaise: number,
  supplierStateCode: string,
  placeOfSupplyCode: string
): { cgstPaise: number; sgstPaise: number; igstPaise: number; intraState: boolean } {
  if (supplierStateCode === placeOfSupplyCode) {
    const cgst = Math.floor(gstPaise / 2);
    return { cgstPaise: cgst, sgstPaise: gstPaise - cgst, igstPaise: 0, intraState: true };
  }
  return { cgstPaise: 0, sgstPaise: 0, igstPaise: gstPaise, intraState: false };
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under100(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}
function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? under100(r) : ""].filter(Boolean).join(" ");
}

/** Whole number in the Indian system: 3,15,945 → "Three Lakh Fifteen Thousand Nine Hundred Forty-Five". */
export function indianWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("indianWords takes a whole number");
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${under100(lakh)} Lakh`);
  if (thousand) parts.push(`${under100(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return parts.join(" ");
}

/** "Indian Rupees Seven Thousand Two Hundred Twenty-Eight Only" (paise added when present). */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  return `Indian Rupees ${indianWords(rupees)}${p ? ` and ${under100(p)} Paise` : ""} Only`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type InvoiceFigures = {
  lines: InvoiceLine[];
  taxablePaise: number;
  gstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
};

/**
 * The invoice's lines for a cycle (and, for a renewal paid after the grace
 * period, the late pro-rata line). Amounts are the quote's, never re-derived.
 * A 6-month commitment reads "CRM subscription — 6-month commitment" and, with
 * no discount, has no discount line.
 */
export function invoiceFigures(args: {
  quote: CycleQuote;
  tierLabel: string;
  periodStart: Date;
  periodEnd: Date;
  late?: LateCharge | null;
  lateFrom?: Date | null;
}): InvoiceFigures {
  const q = args.quote;
  const ps = iso(args.periodStart);
  const pe = iso(new Date(args.periodEnd.getTime() - 86_400_000));
  const label = cycleLabel(q.cycle, q.months);
  const aumText = `${args.tierLabel} (₹${q.aumCrore.toLocaleString("en-IN")} Cr AUM)`;
  const lines: InvoiceLine[] = [
    {
      key: "maintenance",
      description:
        q.cycle === "commitment"
          ? `CRM subscription — ${label}: maintenance, ${aumText}`
          : `CRM maintenance — ${aumText}, ${label.toLowerCase()}`,
      periodStart: ps,
      periodEnd: pe,
      quantity: q.months,
      ratePaise: q.maintenanceMonthlyPaise,
      amountPaise: q.maintenanceMonthlyPaise * q.months,
    },
    {
      key: "users",
      description: `CRM users — ${q.users} × ₹${(q.perUserMonthlyPaise / 100).toLocaleString("en-IN")} a month`,
      periodStart: ps,
      periodEnd: pe,
      quantity: q.users * q.months,
      ratePaise: q.perUserMonthlyPaise,
      amountPaise: q.usersMonthlyPaise * q.months,
    },
  ];
  if (q.discountPaise > 0) {
    lines.push({ key: "discount", description: `${label} discount ${(q.discountBp / 100).toString()}%`, amountPaise: -q.discountPaise });
  }
  let taxable = q.taxablePaise;
  let gst = q.gstPaise;
  let total = q.totalPaise;
  if (args.late) {
    const l = args.late;
    const from = args.lateFrom ?? args.periodStart;
    lines.push({
      key: "late_fee",
      description: `Late renewal — ${l.graceDays} grace days pro-rata (monthly base ₹${(l.monthlyBasePaise / 100).toLocaleString("en-IN")} ÷ ${l.dayBasis} × ${l.graceDays})`,
      periodStart: iso(from),
      periodEnd: iso(new Date(from.getTime() + (l.graceDays - 1) * 86_400_000)),
      quantity: l.graceDays,
      amountPaise: l.taxablePaise,
    });
    taxable += l.taxablePaise;
    gst += l.gstPaise;
    total += l.totalPaise;
  }
  return { lines, taxablePaise: taxable, gstPaise: gst, roundOffPaise: total - taxable - gst, totalPaise: total };
}
