/**
 * A signed legal document as a PDF (pdf-lib): the exact published text, then a
 * signature certificate — who signed, as what, for which firm, when (IST),
 * from which IP and browser, the one-time-code confirmation, and the SHA-256
 * of the text, so the copy can be checked against the version on record.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import { legalBlocks } from "./documents";

export type SignedPdfInput = {
  title: string;
  version: number;
  body: string;
  bodySha256: string;
  firmName: string;
  firmArn: string | null;
  signerName: string;
  designation: string | null;
  email: string;
  acceptedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  otpVerified: boolean;
  supplierName: string;
};

const A4: [number, number] = [595.28, 841.89];
const M = 50;

export async function renderSignedLegalPdf(d: SignedPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.title} v${d.version} — ${d.firmName}`);
  const { font, bold, rupeeOk } = await embedPdfFonts(pdf);
  const T = (s: string) => pdfSanitize(s, rupeeOk);
  const W = A4[0] - 2 * M;
  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;
  const ink = rgb(0.09, 0.14, 0.17);
  const muted = rgb(0.4, 0.45, 0.48);

  const ensure = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage(A4);
      y = A4[1] - M;
    }
  };
  const para = (text: string, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number; indent?: number } = {}) => {
    const size = o.size ?? 9.5;
    const f = o.f ?? font;
    const width = W - (o.indent ?? 0);
    const words = T(text).split(" ");
    let line = "";
    const lines: string[] = [];
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    for (const l of lines) {
      ensure(size + 4);
      page.drawText(l, { x: M + (o.indent ?? 0), y, size, font: f, color: o.color ?? ink });
      y -= size + 4;
    }
    y -= o.gap ?? 5;
  };

  para(d.title, { size: 16, f: bold, gap: 2 });
  para(`Version ${d.version} · between ${d.supplierName} and ${d.firmName}${d.firmArn ? ` (${d.firmArn})` : ""}`, { size: 9, color: muted, gap: 12 });
  for (const b of legalBlocks(d.body)) {
    if (b.type === "h") {
      y -= 4;
      para(b.text, { size: 11, f: bold, gap: 3 });
    } else if (b.type === "p") para(b.text);
    else for (const item of b.items) para(`- ${item}`, { indent: 10, gap: 2 });
  }

  ensure(190);
  y -= 10;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.8, color: rgb(0.85, 0.87, 0.89) });
  y -= 18;
  para("Electronic signature", { size: 12, f: bold, gap: 6 });
  const when = d.acceptedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const rows: Array<[string, string]> = [
    ["Signed by", `${d.signerName}${d.designation ? `, ${d.designation}` : ""}`],
    ["For", `${d.firmName}${d.firmArn ? ` (${d.firmArn})` : ""}`],
    ["Email", d.email],
    ["Signed at", `${when} IST`],
    ["Confirmed by", d.otpVerified ? "One-time code sent to the signer's verified email" : "Tick-box acceptance"],
    ["IP address", d.ipAddress ?? "not recorded"],
    ["Browser", (d.userAgent ?? "not recorded").slice(0, 110)],
    ["Text SHA-256", d.bodySha256],
  ];
  for (const [k, v] of rows) {
    ensure(14);
    page.drawText(T(k), { x: M, y, size: 9, font: bold, color: muted });
    const val = T(v);
    page.drawText(val.length > 96 ? `${val.slice(0, 93)}...` : val, { x: M + 90, y, size: 9, font, color: ink });
    y -= 14;
  }
  return pdf.save();
}
