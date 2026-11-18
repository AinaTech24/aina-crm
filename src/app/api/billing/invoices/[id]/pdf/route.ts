/**
 * GET /api/billing/invoices/[id]/pdf — download one of the firm's GST tax
 * invoices. Drawn from the immutable invoice row, so it is the same document
 * that was emailed. Owner-only (settings.billing); RLS keeps it to the firm.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { INVOICE_COLUMNS, invoiceRowToPdf } from "@/lib/billing/invoice-email";
import { renderInvoicePdf } from "@/lib/billing/invoice-pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!can(session.roles, "settings.billing", session.permissions)) {
      return NextResponse.json({ error: "Only the firm owner can download invoices." }, { status: 403 });
    }
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.execute(sql`SELECT ${INVOICE_COLUMNS} FROM billing_invoices WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid`)).rows[0]
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    const pdf = invoiceRowToPdf(row as Parameters<typeof invoiceRowToPdf>[0]);
    const bytes = await renderInvoicePdf(pdf);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${pdf.invoiceNo.replace(/\//g, "-")}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
