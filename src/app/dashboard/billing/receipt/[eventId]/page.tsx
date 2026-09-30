/**
 * Printable payment receipt / tax invoice for one subscription payment event.
 * Indian businesses need this for their books (and it feeds the Practice
 * Finances expense ledger). Renders a Tax Invoice when the platform's GSTIN is
 * configured, otherwise a plain Payment Receipt. Amounts are treated as
 * GST-inclusive and broken back out at 18%.
 */

import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { subscriptions, subscriptionEvents, packages, tenants } from "@/db/schema";
import { LEGAL } from "@/lib/legal/company";
import { PrintButton } from "@/components/settings/PrintButton";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const GST_RATE = 0.18;
const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function ReceiptPage({ params }: { params: Promise<{ eventId: string }> }) {
  const session = await requireSession();
  if (!(session.roles ?? []).includes("owner")) notFound();
  const { eventId } = await params;

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
