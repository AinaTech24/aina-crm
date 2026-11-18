/**
 * The GST tax invoice as an A4 PDF (pdf-lib, the app's PDF tooling), drawn
 * only from the immutable billing_invoices row — so the PDF emailed today and
 * one downloaded next year are the same document.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import type { InvoiceLine } from "@/db/schema/billing";

export type InvoiceForPdf = {
  invoiceNo: string;
  issuedAt: Date;
  kind: string;
  periodStart: string | null;
  periodEnd: string | null;
  supplier: { legalName?: string; entityType?: string; address?: string; state?: string; stateCode?: string; gstin?: string; pan?: string; email?: string; llpin?: string | null };
  recipient: { legalName?: string; address?: string | null; gstin?: string | null; state?: string | null; stateCode?: string | null };
  placeOfSupply: string;
  sac: string;
  lines: InvoiceLine[];
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  amountInWords: string;
  razorpayPaymentId: string;
  gstBp?: number;
};

const A4: [number, number] = [595.28, 841.89];
const M = 44;

function money(p: number, rupee: boolean): string {
  const s = (Math.abs(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${p < 0 ? "- " : ""}${rupee ? "₹" : "Rs "}${s}`;
}

function fmtDate(iso: string | Date | null): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > width && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

export async function renderInvoicePdf(inv: InvoiceForPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Tax invoice ${inv.invoiceNo}`);
  const { font, bold, rupeeOk } = await embedPdfFonts(pdf);
  const T = (s: string) => pdfSanitize(s, rupeeOk);
  const page: PDFPage = pdf.addPage(A4);
  const ink = rgb(0.09, 0.14, 0.17);
  const muted = rgb(0.4, 0.45, 0.48);
  const rule = rgb(0.86, 0.88, 0.9);
  const W = A4[0] - 2 * M;
  let y = A4[1] - M;

  const text = (s: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const size = o.size ?? 9;
    const f = o.f ?? font;
    const str = T(s);
    const dx = o.right ? x - f.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: dx, y: yy, size, font: f, color: o.color ?? ink });
  };
  const hr = (yy: number) => page.drawLine({ start: { x: M, y: yy }, end: { x: M + W, y: yy }, thickness: 0.8, color: rule });

  // Header
  text("TAX INVOICE", M, y, { size: 18, f: bold });
  text("PAID", M + W, y, { size: 14, f: bold, color: rgb(0.08, 0.5, 0.3), right: true });
  y -= 18;
  text(`Invoice no. ${inv.invoiceNo}`, M, y, { size: 10, f: bold });
  text(`Date ${fmtDate(inv.issuedAt)}`, M + W, y, { size: 10, right: true });
  y -= 22;
  hr(y);
  y -= 16;

  // Supplier | Recipient
  const colW = W / 2 - 10;
  const block = (x: number, title: string, rows: string[]) => {
    let yy = y;
    text(title, x, yy, { size: 8, f: bold, color: muted });
    yy -= 13;
    rows.forEach((r, i) => {
      for (const l of wrap(T(r), i === 0 ? bold : font, 9, colW)) {
        text(l, x, yy, { f: i === 0 ? bold : font });
        yy -= 12;
      }
    });
    return yy;
  };
  const s = inv.supplier;
  const r = inv.recipient;
  const y1 = block(M, "SUPPLIER", [
    s.legalName ?? "",
    s.entityType ?? "",
    s.address ?? "",
    `State: ${s.state ?? ""} (code ${s.stateCode ?? ""})`,
    `GSTIN: ${s.gstin ?? ""}  ·  PAN: ${s.pan ?? ""}`,
    ...(s.llpin ? [`LLPIN: ${s.llpin}`] : []),
    s.email ?? "",
  ].filter(Boolean));
  const y2 = block(M + W / 2 + 10, "BILLED TO", [
    r.legalName ?? "",
    r.address ?? "Address not on record",
    r.state ? `State: ${r.state}${r.stateCode ? ` (code ${r.stateCode})` : ""}` : "State: not on record",
    r.gstin ? `GSTIN: ${r.gstin}` : "GSTIN: not registered",
  ]);
  y = Math.min(y1, y2) - 6;
  hr(y);
  y -= 15;
  text(`Place of supply: ${inv.placeOfSupply}`, M, y);
  text(`SAC: ${inv.sac}`, M + W, y, { right: true });
  y -= 13;
  text(`Service period: ${fmtDate(inv.periodStart)} – ${fmtDate(inv.periodEnd)}`, M, y);
  text("Reverse charge: No", M + W, y, { right: true });
  y -= 18;

  // Lines
  const amtX = M + W;
  const periodX = M + W - 190;
  page.drawRectangle({ x: M, y: y - 4, width: W, height: 16, color: rgb(0.95, 0.96, 0.97) });
  text("Description", M + 4, y, { f: bold, size: 8 });
  text("Period", periodX, y, { f: bold, size: 8 });
  text("Amount", amtX - 4, y, { f: bold, size: 8, right: true });
  y -= 18;
  for (const l of inv.lines) {
    const desc = wrap(T(l.description), font, 9, periodX - M - 14);
    desc.forEach((d, i) => {
      text(d, M + 4, y - i * 12);
    });
    if (l.periodStart) text(`${fmtDate(l.periodStart)} – ${fmtDate(l.periodEnd ?? null)}`, periodX, y, { size: 8, color: muted });
    text(money(l.amountPaise, rupeeOk), amtX - 4, y, { right: true });
    y -= Math.max(1, desc.length) * 12 + 6;
  }
  hr(y + 2);
  y -= 12;

  const sumRow = (label: string, p: number, strong = false) => {
    text(label, periodX, y, { f: strong ? bold : font });
    text(money(p, rupeeOk), amtX - 4, y, { f: strong ? bold : font, right: true });
    y -= 14;
  };
  sumRow("Taxable value", inv.taxablePaise);
  if (inv.igstPaise > 0) sumRow("IGST @ 18%", inv.igstPaise);
  else {
    sumRow("CGST @ 9%", inv.cgstPaise);
    sumRow("SGST @ 9%", inv.sgstPaise);
  }
  if (inv.roundOffPaise !== 0) sumRow("Round off", inv.roundOffPaise);
  hr(y + 6);
  y -= 4;
  sumRow("Total", inv.totalPaise, true);
  y -= 4;
  for (const l of wrap(T(`Amount in words: ${inv.amountInWords}`), font, 9, W)) {
    text(l, M, y);
    y -= 12;
  }
  y -= 8;
  text(`Paid by Razorpay · payment ${inv.razorpayPaymentId}`, M, y);
  y -= 24;
  hr(y);
  y -= 14;
  text("This is a computer-generated tax invoice and does not require a signature.", M, y, { size: 8, color: muted });
  y -= 11;
  text("An issued invoice is never altered; any correction is made by a credit note.", M, y, { size: 8, color: muted });

  return pdf.save();
}
