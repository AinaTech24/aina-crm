/**
 * Email a tax invoice (PDF attached) to the firm's owner, copying the firm's
 * billing email when it has one — through the platform's transactional mail
 * (lib/comms/system-email.ts), never the firm's own client comms pipeline.
 *
 * Exactly once per invoice: the row is locked (SKIP LOCKED) and stamped `sent`
 * in the same transaction, so two workers or a verify + webhook pair never send
 * it twice. A failed send is recorded and retried by the worker's billing job
 * (up to MAX_ATTEMPTS); it never touches the payment.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { sendSystemEmail, actionEmailHtml } from "@/lib/comms/system-email";
import { LEGAL } from "@/lib/legal/company";
import { renderInvoicePdf, type InvoiceForPdf } from "./invoice-pdf";
import { inr } from "./aum-pricing";
import type { InvoiceLine } from "@/db/schema/billing";

export const INVOICE_EMAIL_MAX_ATTEMPTS = 8;

type Row = {
  id: string;
  tenant_id: string;
  invoice_no: string;
  issued_at: string;
  kind: string;
  period_start: string | null;
  period_end: string | null;
  supplier: InvoiceForPdf["supplier"];
  recipient: InvoiceForPdf["recipient"];
  place_of_supply: string;
  sac: string;
  lines: InvoiceLine[];
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  amount_in_words: string;
  razorpay_payment_id: string;
  email_status: string;
  email_attempts: number;
};

export function invoiceRowToPdf(r: Row): InvoiceForPdf {
  return {
    invoiceNo: r.invoice_no,
    issuedAt: new Date(r.issued_at),
    kind: r.kind,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    supplier: r.supplier,
    recipient: r.recipient,
    placeOfSupply: r.place_of_supply,
    sac: r.sac,
    lines: r.lines,
    taxablePaise: Number(r.taxable_paise),
    cgstPaise: Number(r.cgst_paise),
    sgstPaise: Number(r.sgst_paise),
    igstPaise: Number(r.igst_paise),
    roundOffPaise: Number(r.round_off_paise),
    totalPaise: Number(r.total_paise),
    amountInWords: r.amount_in_words,
    razorpayPaymentId: r.razorpay_payment_id,
  };
}

export const INVOICE_COLUMNS = sql`id, tenant_id, invoice_no, issued_at, kind, period_start::text AS period_start, period_end::text AS period_end,
  supplier, recipient, place_of_supply, sac, lines, taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise,
  total_paise, amount_in_words, razorpay_payment_id, email_status, email_attempts`;

/** Send one invoice's email if it has not gone yet. Returns what happened. */
export async function deliverInvoiceEmail(invoiceId: string): Promise<"sent" | "skipped" | "failed" | "no_recipient"> {
  return withSystem(async (tx) => {
    const r = (await tx.execute(sql`
      SELECT ${INVOICE_COLUMNS} FROM billing_invoices
       WHERE id = ${invoiceId}::uuid AND email_status <> 'sent' AND email_attempts < ${INVOICE_EMAIL_MAX_ATTEMPTS}
       FOR UPDATE SKIP LOCKED
    `)).rows[0] as Row | undefined;
    if (!r) return "skipped";

    const people = (await tx.execute(sql`
      SELECT lower(u.email) AS email, u.name FROM users u
       WHERE u.tenant_id = ${r.tenant_id}::uuid AND 'owner' = ANY(u.roles) AND u.status = 'active' AND u.email IS NOT NULL
       ORDER BY u.created_at
    `)).rows as Array<{ email: string; name: string | null }>;
    const firm = (await tx.execute(sql`SELECT billing_email, display_name FROM tenants WHERE id = ${r.tenant_id}::uuid`)).rows[0] as
      | { billing_email: string | null; display_name: string }
      | undefined;
    const to = people[0]?.email ?? firm?.billing_email ?? null;
    if (!to) {
      await tx.execute(sql`UPDATE billing_invoices SET email_status = 'failed', email_attempts = email_attempts + 1, email_last_error = 'no recipient' WHERE id = ${r.id}::uuid`);
      return "no_recipient";
    }
    const cc = [...new Set([...people.slice(1).map((p) => p.email), firm?.billing_email?.toLowerCase() ?? ""])].filter((e) => e && e !== to);

    const pdf = Buffer.from(await renderInvoicePdf(invoiceRowToPdf(r)));
    const base = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? LEGAL.url;
    const total = inr(Number(r.total_paise));
    const res = await sendSystemEmail({
      tenantId: r.tenant_id,
      to,
      cc,
      subject: `Tax invoice ${r.invoice_no} — ${total} paid`,
      text:
        `Hello${people[0]?.name ? ` ${people[0].name}` : ""},\n\nThank you — we received ${total} for ${firm?.display_name ?? "your firm"}'s Aina CRM subscription. ` +
        `Your GST tax invoice ${r.invoice_no} is attached.\n\nYou can download every invoice from Billing: ${base}/dashboard/billing\n\n— ${LEGAL.legalEntity}`,
      html: actionEmailHtml({
        heading: `Tax invoice ${r.invoice_no}`,
        intro: `Thank you — we received ${total} for ${firm?.display_name ?? "your firm"}'s Aina CRM subscription. Your GST tax invoice is attached as a PDF.`,
        buttonLabel: "Open Billing",
        buttonUrl: `${base}/dashboard/billing`,
        note: `${LEGAL.legalEntity} · GSTIN ${LEGAL.gstin}`,
      }),
      idempotencyKey: `invoice:${r.id}`,
      attachments: [{ filename: `${r.invoice_no.replace(/\//g, "-")}.pdf`, content: pdf }],
    });
    if (res.sent) {
      await tx.execute(sql`UPDATE billing_invoices SET email_status = 'sent', email_sent_at = now(), email_attempts = email_attempts + 1, email_last_error = NULL WHERE id = ${r.id}::uuid`);
      return "sent";
    }
    await tx.execute(sql`UPDATE billing_invoices SET email_status = 'failed', email_attempts = email_attempts + 1, email_last_error = ${res.reason ?? "send failed"} WHERE id = ${r.id}::uuid`);
    return "failed";
  });
}

/** Worker: retry every invoice whose email has not gone, oldest first. */
export async function retryInvoiceEmails(limit = 50): Promise<{ tried: number; sent: number }> {
  const ids = await withSystem(async (tx) =>
    ((await tx.execute(sql`
      SELECT id FROM billing_invoices
       WHERE email_status <> 'sent' AND email_attempts < ${INVOICE_EMAIL_MAX_ATTEMPTS}
       ORDER BY created_at LIMIT ${limit}
    `)).rows as Array<{ id: string }>).map((r) => r.id)
  );
  let sent = 0;
  for (const id of ids) {
    try {
      if ((await deliverInvoiceEmail(id)) === "sent") sent++;
    } catch (err) {
      console.error("[billing] invoice email retry failed:", (err as Error)?.message);
    }
  }
  return { tried: ids.length, sent };
}
