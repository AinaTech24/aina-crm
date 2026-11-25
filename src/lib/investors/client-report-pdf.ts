/**
 * The consolidated client report (2026-11-25, Investment Options): one A4 PDF
 * with everything the CRM holds about a client — profile and KYC, family,
 * mutual fund portfolio, SIPs, transactions, FDs, goals, insurance policies
 * and claims, opportunities, meetings, the activity log, tasks, service
 * requests, messages and documents.
 *
 * This file only LAYS OUT a list of blocks (see client-report.ts for the data).
 * Pure pdf-lib: the firm's letterhead on page 1 (logo, title, ARN, brand
 * strip), a slim continuation header on later pages, and a footer on every
 * page. Tables wrap their cells, break across pages and repeat their header;
 * a heading never sits alone at the foot of a page.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
import { drawReportHeader, drawContinuationHeader, drawPageNumbers } from "@/lib/pdf/report-header";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";

export type ReportColumn = { h: string; w: number; right?: boolean };

export type ReportBlock =
  | { t: "h1"; text: string; note?: string }
  | { t: "h2"; text: string }
  | { t: "stats"; items: { label: string; value: string; sub?: string }[] }
  | { t: "kv"; items: [string, string][]; cols?: number }
  | { t: "table"; cols: ReportColumn[]; rows: string[][]; maxLines?: number }
  | { t: "para"; text: string; muted?: boolean }
  | { t: "empty"; text: string };

export type ClientReportBrand = {
  firmName: string;
  arn?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoBytes?: Uint8Array | null;
};

export type ClientReportInput = {
  brand: ClientReportBrand;
  title: string;
  clientName: string;
  subtitles: string[];
  footerNote: string;
  blocks: ReportBlock[];
};

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const FOOTER_TOP = 46;
const INK = rgb(0.09, 0.12, 0.2);
const SLATE = rgb(0.38, 0.43, 0.51);
const LINE = rgb(0.88, 0.9, 0.93);
const ZEBRA = rgb(0.972, 0.976, 0.984);

function hexToRgb(hex: string | null | undefined, fallback: RGB): RGB {
  const h = (hex ?? "").replace("#", "");
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return fallback;
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const toward = (c: RGB, t: number) => rgb(c.red + (1 - c.red) * t, c.green + (1 - c.green) * t, c.blue + (1 - c.blue) * t);

async function embedLogo(doc: PDFDocument, bytes?: Uint8Array | null): Promise<PDFImage | null> {
  if (!bytes || bytes.length < 8) return null;
  try {
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    return png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

export async function renderClientReportPdf(input: ClientReportInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const { font, bold, rupeeOk } = await embedPdfFonts(doc);
  const san = (s: string) => pdfSanitize(String(s ?? ""), rupeeOk);
  const primary = hexToRgb(input.brand.primaryColor, rgb(0.055, 0.145, 0.341));
  const secondary = hexToRgb(input.brand.secondaryColor, rgb(0.055, 0.647, 0.914));
  const tint = toward(primary, 0.92);
  const logo = await embedLogo(doc, input.brand.logoBytes);

  doc.setTitle(san(`${input.title} - ${input.clientName}`));
  doc.setAuthor(san(input.brand.firmName));
  doc.setProducer("Aina CRM");

  const [W, H] = A4;
  const usable = W - 2 * M;
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    const first = doc.getPageCount() === 0;
    page = doc.addPage(A4);
    y = first
      ? drawReportHeader({
          page, helv: font, bold, pageWidth: W, pageHeight: H, margin: M, logo,
          firmName: input.brand.firmName, title: input.title, subtitles: input.subtitles,
          arn: input.brand.arn, primary, secondary,
        })
      : drawContinuationHeader({
          page, helv: font, bold, pageWidth: W, pageHeight: H, margin: M,
          firmName: input.brand.firmName, title: `${input.title} - ${input.clientName}`, primary,
        });
    // Footer: a hairline and the confidentiality note; page numbers come last.
    page.drawLine({ start: { x: M, y: FOOTER_TOP - 6 }, end: { x: W - M, y: FOOTER_TOP - 6 }, thickness: 0.5, color: LINE });
    for (const [i, l] of wrap(input.footerNote, font, 6.8, usable).slice(0, 2).entries()) {
      page.drawText(l, { x: M, y: FOOTER_TOP - 15 - i * 8.5, size: 6.8, font, color: SLATE });
    }
  };
  const ensure = (h: number) => {
    if (y - h < FOOTER_TOP + 4) newPage();
  };

  function wrap(text: string, f: PDFFont, size: number, max: number): string[] {
    const out: string[] = [];
    for (const para of String(text ?? "").split(/\n+/)) {
      const words = san(para).split(" ").filter(Boolean);
      let line = "";
      for (let w of words) {
        // A single word longer than the cell (an email, a policy number) is cut.
        while (f.widthOfTextAtSize(w, size) > max && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > max) cut--;
          if (line) { out.push(line); line = ""; }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const test = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) > max && line) { out.push(line); line = w; }
        else line = test;
      }
      if (line) out.push(line);
    }
    return out.length ? out : [""];
  }
  const capLines = (lines: string[], n: number) => (lines.length <= n ? lines : [...lines.slice(0, n - 1), `${lines[n - 1]} ...`]);

  newPage();

  for (let bi = 0; bi < input.blocks.length; bi++) {
    const b = input.blocks[bi];
    switch (b.t) {
      case "h1": {
        // Keep the heading with at least the start of what follows.
        ensure(70);
        y -= 8;
        page.drawRectangle({ x: M, y: y - 17, width: usable, height: 21, color: tint });
        page.drawRectangle({ x: M, y: y - 17, width: 3, height: 21, color: primary });
        page.drawText(san(b.text), { x: M + 10, y: y - 11, size: 11, font: bold, color: primary });
        if (b.note) {
          const n = san(b.note);
          page.drawText(n, { x: W - M - 8 - font.widthOfTextAtSize(n, 8), y: y - 10.5, size: 8, font, color: SLATE });
        }
        y -= 29;
        break;
      }
      case "h2": {
        ensure(50);
        y -= 4;
        page.drawText(san(b.text), { x: M, y: y - 9, size: 9.5, font: bold, color: INK });
        y -= 16;
        break;
      }
      case "para":
      case "empty": {
        const size = 8.5;
        const lines = wrap(b.text, font, size, usable);
        for (const l of lines) {
          ensure(12);
          page.drawText(l, { x: M, y: y - 9, size, font, color: b.t === "empty" || (b.t === "para" && b.muted) ? SLATE : INK });
          y -= 11.5;
        }
        y -= 4;
        break;
      }
      case "stats": {
        // Balanced rows: five tiles go 3 + 2, never 4 + 1.
        const per = Math.ceil(b.items.length / Math.ceil(b.items.length / 4)) || 1;
        const gap = 8;
        for (let i = 0; i < b.items.length; i += per) {
          const row = b.items.slice(i, i + per);
          const rw = (usable - gap * (row.length - 1)) / row.length;
          const th = 44;
          ensure(th + gap);
          row.forEach((s, j) => {
            const x = M + j * (rw + gap);
            page.drawRectangle({ x, y: y - th, width: rw, height: th, color: tint });
            page.drawText(clip(s.label, font, 7.5, rw - 14), { x: x + 7, y: y - 12, size: 7.5, font, color: SLATE });
            page.drawText(clip(s.value, bold, 12, rw - 14), { x: x + 7, y: y - 27, size: 12, font: bold, color: INK });
            if (s.sub) page.drawText(clip(s.sub, font, 7, rw - 14), { x: x + 7, y: y - 38, size: 7, font, color: SLATE });
          });
          y -= th + gap;
        }
        y -= 2;
        break;
      }
      case "kv": {
        const cols = b.cols ?? 3;
        const gap = 12;
        const cw = (usable - gap * (cols - 1)) / cols;
        const items = b.items.filter(([, v]) => v != null && String(v).trim() !== "");
        for (let i = 0; i < items.length; i += cols) {
          const row = items.slice(i, i + cols);
          const vals = row.map(([, v]) => capLines(wrap(v, font, 8.5, cw), 4));
          const h = 11 + Math.max(...vals.map((v) => v.length)) * 10.5 + 5;
          ensure(h);
          row.forEach(([label], j) => {
            const x = M + j * (cw + gap);
            page.drawText(clip(label, font, 7, cw), { x, y: y - 7, size: 7, font, color: SLATE });
            vals[j].forEach((l, k) => page.drawText(l, { x, y: y - 17.5 - k * 10.5, size: 8.5, font, color: INK }));
          });
          y -= h;
        }
        y -= 4;
        break;
      }
      case "table": {
        const total = b.cols.reduce((s, c) => s + c.w, 0);
        const widths = b.cols.map((c) => (c.w / total) * usable);
        const size = 7.4;
        const lh = 9;
        const pad = 4;
        const maxLines = b.maxLines ?? 6;
        const drawHead = () => {
          const heads = b.cols.map((c, i) => capLines(wrap(c.h, bold, 7, widths[i] - 2 * pad), 2));
          const hh = Math.max(...heads.map((h) => h.length)) * 8.5 + 2 * pad;
          page.drawRectangle({ x: M, y: y - hh, width: usable, height: hh, color: toward(primary, 0.84) });
          let x = M;
          heads.forEach((lines, i) => {
            lines.forEach((l, k) => {
              const tx = b.cols[i].right ? x + widths[i] - pad - bold.widthOfTextAtSize(l, 7) : x + pad;
              page.drawText(l, { x: tx, y: y - pad - 6.5 - k * 8.5, size: 7, font: bold, color: INK });
            });
            x += widths[i];
          });
          y -= hh;
        };
        ensure(40);
        drawHead();
        b.rows.forEach((r, ri) => {
          const cells = b.cols.map((_, i) => capLines(wrap(r[i] ?? "", font, size, widths[i] - 2 * pad), maxLines));
          const rh = Math.max(...cells.map((c) => c.length)) * lh + 2 * pad - 1;
          if (y - rh < FOOTER_TOP + 4) { newPage(); drawHead(); }
          if (ri % 2 === 1) page.drawRectangle({ x: M, y: y - rh, width: usable, height: rh, color: ZEBRA });
          let x = M;
          cells.forEach((lines, i) => {
            lines.forEach((l, k) => {
              const tx = b.cols[i].right ? x + widths[i] - pad - font.widthOfTextAtSize(l, size) : x + pad;
              page.drawText(l, { x: tx, y: y - pad - 6.4 - k * lh, size, font, color: INK });
            });
            x += widths[i];
          });
          y -= rh;
          page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: LINE });
        });
        y -= 10;
        break;
      }
    }
  }

  function clip(text: string, f: PDFFont, size: number, max: number): string {
    let s = san(text);
    if (f.widthOfTextAtSize(s, size) <= max) return s;
    while (s.length > 1 && f.widthOfTextAtSize(`${s}...`, size) > max) s = s.slice(0, -1);
    return `${s}...`;
  }

  drawPageNumbers(doc, font, W, 14);
  return Buffer.from(await doc.save());
}
