/**
 * The tax invoice PDF is drawn from the invoice row alone — intra-state
 * (CGST + SGST), inter-state (IGST), a recipient without a GSTIN, a late line.
 */
import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoiceForPdf } from "@/lib/billing/invoice-pdf";
import { invoiceFigures, splitGst, amountInWords } from "@/lib/billing/invoice-core";
import { quoteCycle, lateProRataCharge } from "@/lib/billing/aum-pricing";
import { supplierDetails, recipientFrom } from "@/lib/billing/invoice";

function invoice(stateCode: string, late = false): InvoiceForPdf {
  const q = quoteCycle({ aumCrore: 300, users: 5, cycle: "monthly" });
  const start = new Date("2026-11-20T06:00:00Z");
  const f = invoiceFigures({ quote: q, tierLabel: q.tierLabel, periodStart: start, periodEnd: new Date("2026-12-20T06:00:00Z"), late: late ? lateProRataCharge(q.monthlyBasePaise) : null, lateFrom: new Date("2026-11-10T06:00:00Z") });
  const t = splitGst(f.gstPaise, "24", stateCode);
  return {
    invoiceNo: "AINA/2026-27/000001",
    issuedAt: start,
    kind: late ? "late_renewal" : "first",
    periodStart: "2026-11-20",
    periodEnd: "2026-12-19",
    supplier: supplierDetails(),
    recipient: recipientFrom({ legal_name: "Mehta Wealth", address: { state: stateCode === "24" ? "Gujarat" : "Maharashtra" }, gst_number: null, email: null }),
    placeOfSupply: stateCode === "24" ? "Gujarat (24)" : "Maharashtra (27)",
    sac: "998314",
    lines: f.lines,
    taxablePaise: f.taxablePaise,
    cgstPaise: t.cgstPaise,
    sgstPaise: t.sgstPaise,
    igstPaise: t.igstPaise,
    roundOffPaise: f.roundOffPaise,
    totalPaise: f.totalPaise,
    amountInWords: amountInWords(f.totalPaise),
    razorpayPaymentId: "pay_test",
  };
}

describe("tax invoice PDF", () => {
  it("renders intra-state, inter-state and late invoices for a recipient without GSTIN", async () => {
    for (const inv of [invoice("24"), invoice("27"), invoice("27", true)]) {
      const bytes = await renderInvoicePdf(inv);
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
      expect(inv.cgstPaise + inv.sgstPaise + inv.igstPaise + inv.taxablePaise + inv.roundOffPaise).toBe(inv.totalPaise);
      expect(inv.recipient.gstin).toBeNull();
    }
    expect(invoice("27", true).totalPaise).toBe(3_097_500 + 722_800);
  });

  it("prints AINA's GST registration as the supplier", () => {
    expect(supplierDetails()).toMatchObject({ legalName: "AINA TECH SERVICES LLP", gstin: "24ACKFA5449H1ZB", pan: "ACKFA5449H", stateCode: "24", state: "Gujarat" });
  });
});
