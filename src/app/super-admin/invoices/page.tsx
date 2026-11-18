/**
 * Aina Admin → Tax invoices. Every GST tax invoice issued, newest first, or
 * one firm's (?tenant=). Each is immutable; download the PDF of any.
 */
import Link from "next/link";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { Badge } from "@/components/ui/Badge";
import { InlineEmpty } from "@/components/common/EmptyState";
import { inr } from "@/lib/billing/aum-pricing";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  tenant_id: string;
  invoice_no: string;
  issued_at: string;
  kind: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  email_status: string;
  razorpay_payment_id: string;
  firm: string | null;
};

export default async function PlatformInvoicesPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");
  const { tenant } = await searchParams;
  const byTenant = tenant && /^[0-9a-f-]{36}$/i.test(tenant) ? tenant : null;
  const rows = await withSystem(async (tx) =>
    (await tx.execute(sql`
      SELECT i.id, i.tenant_id, i.invoice_no, i.issued_at, i.kind, i.taxable_paise, i.cgst_paise, i.sgst_paise, i.igst_paise,
             i.total_paise, i.email_status, i.razorpay_payment_id, t.display_name AS firm
        FROM billing_invoices i LEFT JOIN tenants t ON t.id = i.tenant_id
       WHERE ${byTenant ? sql`i.tenant_id = ${byTenant}::uuid` : sql`true`}
       ORDER BY i.issued_at DESC LIMIT 500
    `)).rows as Row[]
  );
  const totals = rows.reduce((a, r) => ({ taxable: a.taxable + Number(r.taxable_paise), gst: a.gst + Number(r.cgst_paise) + Number(r.sgst_paise) + Number(r.igst_paise), total: a.total + Number(r.total_paise) }), { taxable: 0, gst: 0, total: 0 });

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="page-title">Tax invoices</h1>
        <p className="text-muted-foreground text-sm">
          {rows.length} invoice{rows.length === 1 ? "" : "s"}{byTenant && rows[0]?.firm ? ` for ${rows[0].firm}` : ""} · taxable {inr(totals.taxable)} · GST {inr(totals.gst)} · total {inr(totals.total)}.
          {byTenant && <> <Link className="text-primary underline" href="/super-admin/invoices">All firms</Link>.</>}
        </p>
      </div>
      {rows.length === 0 ? (
        <InlineEmpty message="No invoices yet." />
      ) : (
        <div className="table-scroll card-surface">
          <table className="table-modern w-full text-sm">
            <caption className="sr-only">Tax invoices, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Firm</th>
                <th scope="col" className="text-right">Taxable</th>
                <th scope="col" className="text-right">GST</th>
                <th scope="col" className="text-right">Total</th>
                <th scope="col">Email</th>
                <th scope="col"><span className="sr-only">Download</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <div className="font-medium">{r.invoice_no}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(r.issued_at)} · {r.kind.replace("_", " ")}</div>
                  </td>
                  <td>
                    <Link className="text-primary underline" href={`/super-admin/invoices?tenant=${r.tenant_id}`}>{r.firm ?? r.tenant_id.slice(0, 8)}</Link>
                  </td>
                  <td className="text-right tabular-nums">{inr(Number(r.taxable_paise))}</td>
                  <td className="text-right tabular-nums">{inr(Number(r.cgst_paise) + Number(r.sgst_paise) + Number(r.igst_paise))}<div className="text-xs text-muted-foreground">{Number(r.igst_paise) > 0 ? "IGST" : "CGST+SGST"}</div></td>
                  <td className="text-right tabular-nums font-medium">{inr(Number(r.total_paise))}</td>
                  <td><Badge tone={r.email_status === "sent" ? "success" : r.email_status === "failed" ? "danger" : "neutral"}>{r.email_status}</Badge></td>
                  <td><a className="text-primary underline" href={`/api/super-admin/invoices/${r.id}/pdf`}>PDF</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
