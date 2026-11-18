/**
 * The GST tax invoice for a payment — the receipt became the tax invoice
 * (owner's addition E, 2026-11-18); there is no second document.
 *
 * The id is a billing_invoices id (the Billing list links those), or a
 * subscription event id (the activity history) whose payment has an invoice.
 * Both render the immutable invoice row: supplier, recipient, place of supply,
 * SAC, the lines with their service period, CGST + SGST or IGST, total, amount
 * in words, the Razorpay payment id — and a PDF download of the same.
 * Payments recorded before invoices existed keep the old payment receipt.
 */

import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { subscriptions, subscriptionEvents, packages, tenants } from "@/db/schema";
import { LEGAL } from "@/lib/legal/company";
import { PrintButton } from "@/components/settings/PrintButton";
import { formatDate } from "@/lib/format";
import { sql } from "drizzle-orm";
import { buttonClass } from "@/components/ui/button-class";
import { INVOICE_COLUMNS, invoiceRowToPdf } from "@/lib/billing/invoice-email";
import type { InvoiceForPdf } from "@/lib/billing/invoice-pdf";

export const dynamic = "force-dynamic";

const GST_RATE = 0.18;
const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function ReceiptPage({ params }: { params: Promise<{ eventId: string }> }) {
  const session = await requireSession();
  if (!(session.roles ?? []).includes("owner")) notFound();
  const { eventId } = await params;

  const invoice = await withTenant(session.tenantId, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
    const direct = (await tx.execute(sql`SELECT ${INVOICE_COLUMNS} FROM billing_invoices WHERE id = ${eventId}::uuid AND tenant_id = ${session.tenantId}::uuid`)).rows[0];
    if (direct) return direct;
    return (await tx.execute(sql`
      SELECT ${INVOICE_COLUMNS} FROM billing_invoices
       WHERE tenant_id = ${session.tenantId}::uuid
         AND id = (SELECT (meta->>'invoiceId')::uuid FROM subscription_events WHERE id = ${eventId}::uuid AND tenant_id = ${session.tenantId}::uuid AND meta ? 'invoiceId')
    `)).rows[0] ?? null;
  });
  if (invoice) {
    const row = invoice as unknown as Parameters<typeof invoiceRowToPdf>[0];
    return <TaxInvoice inv={invoiceRowToPdf(row)} id={row.id} />;
  }

  const data = await withTenant(session.tenantId, async (tx) => {
    const ev = (
      await tx
        .select()
        .from(subscriptionEvents)
        .where(and(eq(subscriptionEvents.id, eventId), eq(subscriptionEvents.tenantId, session.tenantId)))
        .limit(1)
    )[0];
    if (!ev || ev.amountPaise == null) return null;
    const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
    const sub = (await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, session.tenantId)).limit(1))[0] ?? null;
    const pkg = sub ? (await tx.select().from(packages).where(eq(packages.id, sub.packageId)).limit(1))[0] ?? null : null;
    return { ev, tenant, sub, pkg };
  });

  if (!data) notFound();

  const total = data.ev.amountPaise!;
  const base = Math.round(total / (1 + GST_RATE));
  const gst = total - base;
  const isTaxInvoice = !!LEGAL.gstin;
  const docTitle = isTaxInvoice ? "Tax Invoice" : "Payment Receipt";
  const addr = (data.tenant.address as any) ?? null;
  const buyerAddr = addr ? [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ") : "";

  return (
    <div className="max-w-3xl mx-auto space-y-5 print:space-y-3">
      <div className="flex items-center justify-between print:hidden">
        <a href="/dashboard/billing" className="text-sm text-muted-foreground hover:underline">← Back to billing</a>
        <PrintButton />
      </div>

      <div className="border rounded-lg bg-card p-8 print:border-0 print:p-0 space-y-6 text-sm">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xl font-bold">{docTitle}</div>
            <div className="text-xs text-muted-foreground mt-1">
              No. {data.ev.id.slice(0, 8).toUpperCase()} · {formatDate(new Date(data.ev.at))}
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold text-base">{LEGAL.legalEntity}</div>
            <div className="text-xs text-muted-foreground">{LEGAL.address}</div>
            <div className="text-xs text-muted-foreground">{LEGAL.email}</div>
            {LEGAL.gstin && <div className="text-xs text-muted-foreground">GSTIN: {LEGAL.gstin}</div>}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="text-2xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Billed to</div>
          <div className="font-medium">{data.tenant.legalName}</div>
          {buyerAddr && <div className="text-xs text-muted-foreground">{buyerAddr}</div>}
          <div className="text-xs text-muted-foreground">ARN: {data.tenant.arn}{data.tenant.gstNumber ? ` · GSTIN: ${data.tenant.gstNumber}` : ""}</div>
        </div>

        <table className="w-full border-t">
          <thead>
            <tr className="text-2xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left py-2">Description</th>
              <th className="text-right py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="py-2">
                {data.pkg?.name ?? "Subscription"} — {data.sub?.billingCycle ?? "subscription"} plan
                <div className="text-xs text-muted-foreground">{data.ev.eventType.replace(/_/g, " ")}{data.ev.notes ? ` · ${data.ev.notes}` : ""}</div>
              </td>
              <td className="py-2 text-right tabular-nums">{inr(base)}</td>
            </tr>
            <tr className="border-t">
              <td className="py-2 text-muted-foreground">GST @ 18%</td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">{inr(gst)}</td>
            </tr>
            <tr className="border-t font-bold">
              <td className="py-2">Total paid</td>
              <td className="py-2 text-right tabular-nums">{inr(total)}</td>
            </tr>
          </tbody>
        </table>

        <div className="border-t pt-4 text-xs text-muted-foreground">
          {isTaxInvoice
            ? "This is a computer-generated tax invoice and does not require a signature."
            : "This is a payment receipt. Amounts are inclusive of GST at 18%."}
          <div className="mt-1">Paid via {data.ev.actor?.includes("razorpay") ? "Razorpay" : "the billing system"}. For queries, contact {LEGAL.email}.</div>
        </div>
      </div>
    </div>
  );
}

const money = (p: number) => `${p < 0 ? "− " : ""}₹${(Math.abs(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function TaxInvoice({ inv, id }: { inv: InvoiceForPdf; id: string }) {
  const s = inv.supplier;
  const r = inv.recipient;
  return (
    <div className="max-w-3xl mx-auto space-y-5 print:space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <a href="/dashboard/billing" className="text-sm text-muted-foreground hover:underline">← Back to billing</a>
        <div className="flex gap-2">
          <a className={buttonClass("secondary", "sm")} href={`/api/billing/invoices/${id}/pdf`}>Download PDF</a>
          <PrintButton />
        </div>
      </div>
      <div className="card-surface p-5 sm:p-8 print:border-0 print:p-0 space-y-6 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xl font-bold">Tax Invoice</div>
            <div className="text-xs text-muted-foreground mt-1">No. {inv.invoiceNo} · {formatDate(inv.issuedAt)}</div>
          </div>
          <span className="chip bg-success/10 text-success">Paid</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 border-t border-border pt-4">
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Supplier</div>
            <div className="font-medium">{s.legalName}</div>
            <div className="text-xs text-muted-foreground">{s.entityType}</div>
            <div className="text-xs text-muted-foreground">{s.address}</div>
            <div className="text-xs text-muted-foreground">State: {s.state} (code {s.stateCode})</div>
            <div className="text-xs text-muted-foreground">GSTIN: {s.gstin} · PAN: {s.pan}</div>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">Billed to</div>
            <div className="font-medium">{r.legalName}</div>
            <div className="text-xs text-muted-foreground">{r.address ?? "Address not on record"}</div>
            <div className="text-xs text-muted-foreground">State: {r.state ? `${r.state}${r.stateCode ? ` (code ${r.stateCode})` : ""}` : "not on record"}</div>
            <div className="text-xs text-muted-foreground">GSTIN: {r.gstin ?? "not registered"}</div>
          </div>
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>Place of supply: {inv.placeOfSupply}</span>
          <span>SAC: {inv.sac}</span>
          <span>Reverse charge: No</span>
        </div>
        <table className="w-full border-t border-border">
          <thead>
            <tr className="text-2xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left py-2">Description</th>
              <th className="text-right py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-2">
                  {l.description}
                  {l.periodStart && <div className="text-xs text-muted-foreground">{formatDate(l.periodStart)} – {formatDate(l.periodEnd ?? null)}</div>}
                </td>
                <td className="py-2 text-right tabular-nums">{money(l.amountPaise)}</td>
              </tr>
            ))}
            <tr className="border-t border-border"><td className="py-2">Taxable value</td><td className="py-2 text-right tabular-nums">{money(inv.taxablePaise)}</td></tr>
            {inv.igstPaise > 0 ? (
              <tr><td className="py-1 text-muted-foreground">IGST @ 18%</td><td className="py-1 text-right tabular-nums">{money(inv.igstPaise)}</td></tr>
            ) : (
              <>
                <tr><td className="py-1 text-muted-foreground">CGST @ 9%</td><td className="py-1 text-right tabular-nums">{money(inv.cgstPaise)}</td></tr>
                <tr><td className="py-1 text-muted-foreground">SGST @ 9%</td><td className="py-1 text-right tabular-nums">{money(inv.sgstPaise)}</td></tr>
              </>
            )}
            {inv.roundOffPaise !== 0 && <tr><td className="py-1 text-muted-foreground">Round off</td><td className="py-1 text-right tabular-nums">{money(inv.roundOffPaise)}</td></tr>}
            <tr className="border-t border-border font-bold"><td className="py-2">Total</td><td className="py-2 text-right tabular-nums">{money(inv.totalPaise)}</td></tr>
          </tbody>
        </table>
        <div className="text-xs">{inv.amountInWords}</div>
        <div className="border-t border-border pt-4 text-xs text-muted-foreground space-y-1">
          <div>Paid by Razorpay · payment {inv.razorpayPaymentId}</div>
          <div>This is a computer-generated tax invoice and does not require a signature. An issued invoice is never altered; a correction is made by a credit note.</div>
        </div>
      </div>
    </div>
  );
}
