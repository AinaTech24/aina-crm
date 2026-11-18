/**
 * Issue the GST tax invoice for a Razorpay payment (owner's addition E).
 *
 * Runs INSIDE the payment's transaction, under withSystem (the counters are
 * platform-level). One invoice per payment id (UNIQUE) — a duplicate webhook,
 * or verify + webhook for the same payment, gets the existing invoice back.
 * The number comes from billing_invoice_counters: the UPSERT takes that FY's
 * row lock, so concurrent payments queue and a rolled-back payment hands its
 * number back — the series has no gaps. An issued invoice is immutable
 * (trigger); only its email bookkeeping moves.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { LEGAL } from "@/lib/legal/company";
import { checkGstin, gstState } from "@/lib/legal/gst";
import { amountInWords, financialYear, invoiceNumber, splitGst, type InvoiceFigures } from "./invoice-core";

export type IssueInvoiceArgs = {
  tenantId: string;
  subscriptionId: string | null;
  paymentId: string;
  kind: "first" | "renewal" | "late_renewal";
  figures: InvoiceFigures;
  periodStart: Date;
  periodEnd: Date;
  sac: string;
  paidAt: Date;
};

export function supplierDetails() {
  return {
    legalName: LEGAL.legalEntity,
    entityType: LEGAL.entityType,
    address: LEGAL.address,
    state: LEGAL.state,
    stateCode: LEGAL.stateCode,
    gstin: LEGAL.gstin,
    pan: LEGAL.pan,
    email: LEGAL.email,
    llpin: LEGAL.llpin || null,
  };
}

type TenantRow = {
  legal_name: string;
  address: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string } | null;
  gst_number: string | null;
  email: string | null;
};

export function recipientFrom(t: TenantRow) {
  const g = t.gst_number ? checkGstin(t.gst_number) : null;
  const gstin = g && g.ok ? g.gstin : null;
  const st = gstState(t.address?.state) ?? (gstin ? gstState(gstin.slice(0, 2)) : null);
  const addr = t.address ? [t.address.line1, t.address.line2, t.address.city, t.address.state, t.address.pincode].filter(Boolean).join(", ") : "";
  return {
    legalName: t.legal_name,
    address: addr || null,
    gstin,
    state: st?.name ?? null,
    stateCode: st?.code ?? null,
  };
}

export async function issueInvoice(tx: Tx, a: IssueInvoiceArgs): Promise<{ id: string; invoiceNo: string; created: boolean }> {
  const existing = (await tx.execute(sql`
    SELECT id, invoice_no FROM billing_invoices WHERE razorpay_payment_id = ${a.paymentId} LIMIT 1
  `)).rows[0] as { id: string; invoice_no: string } | undefined;
  if (existing) return { id: existing.id, invoiceNo: existing.invoice_no, created: false };

  const t = (await tx.execute(sql`
    SELECT legal_name, address, gst_number, email FROM tenants WHERE id = ${a.tenantId}::uuid
  `)).rows[0] as TenantRow | undefined;
  if (!t) throw new Error("issueInvoice: firm not found");

  const supplier = supplierDetails();
  const recipient = recipientFrom(t);
  // Place of supply: the recipient's state on record, else the supplier's location.
  const posCode = recipient.stateCode ?? supplier.stateCode;
  const pos = gstState(posCode)?.name ?? supplier.state;
  const tax = splitGst(a.figures.gstPaise, supplier.stateCode, posCode);

  const fy = financialYear(a.paidAt);
  const seqRow = (await tx.execute(sql`
    INSERT INTO billing_invoice_counters (financial_year, last_seq) VALUES (${fy}, 1)
    ON CONFLICT (financial_year) DO UPDATE SET last_seq = billing_invoice_counters.last_seq + 1
    RETURNING last_seq
  `)).rows[0] as { last_seq: number };
  const seq = Number(seqRow.last_seq);
  const no = invoiceNumber(LEGAL.invoicePrefix, fy, seq);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const ins = (await tx.execute(sql`
    INSERT INTO billing_invoices (
      tenant_id, subscription_id, invoice_no, financial_year, seq, razorpay_payment_id, kind, issued_at,
      period_start, period_end, supplier, recipient, place_of_supply, sac, lines,
      taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, amount_in_words
    ) VALUES (
      ${a.tenantId}::uuid, ${a.subscriptionId}::uuid, ${no}, ${fy}, ${seq}, ${a.paymentId}, ${a.kind}, ${a.paidAt},
      ${iso(a.periodStart)}::date, ${iso(new Date(a.periodEnd.getTime() - 86_400_000))}::date,
      ${JSON.stringify(supplier)}::jsonb, ${JSON.stringify(recipient)}::jsonb, ${`${pos} (${posCode})`}, ${a.sac},
      ${JSON.stringify(a.figures.lines)}::jsonb,
      ${a.figures.taxablePaise}, ${tax.cgstPaise}, ${tax.sgstPaise}, ${tax.igstPaise}, ${a.figures.roundOffPaise},
      ${a.figures.totalPaise}, ${amountInWords(a.figures.totalPaise)}
    )
    RETURNING id
  `)).rows[0] as { id: string };
  return { id: ins.id, invoiceNo: no, created: true };
}
