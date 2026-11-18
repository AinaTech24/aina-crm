/**
 * GET /api/super-admin/invoices/[id]/pdf — any firm's tax invoice, for Aina's
 * own books. Platform-admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { INVOICE_COLUMNS, invoiceRowToPdf } from "@/lib/billing/invoice-email";
import { renderInvoicePdf } from "@/lib/billing/invoice-pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const row = await withSystem(async (tx) => (await tx.execute(sql`SELECT ${INVOICE_COLUMNS} FROM billing_invoices WHERE id = ${id}::uuid`)).rows[0]);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    const inv = invoiceRowToPdf(row as unknown as Parameters<typeof invoiceRowToPdf>[0]);
    return new NextResponse(Buffer.from(await renderInvoicePdf(inv)), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${inv.invoiceNo.replace(/\//g, "-")}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
