/**
 * calc-pdf — render a branded PDF from a captured calculator result (title +
 * ordered blocks of stats / tables / insights). Built with pdf-lib (Node
 * runtime). Used by the calculator Email / WhatsApp share paths so an
 * illustration looks like an official firm document. The layout paginates:
 * every captured stat/row/insight is rendered, spilling onto a 2nd/3rd A4 page
 * when needed, and long projection tables repeat their header after a break.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

export type PdfBlock =
  | { type: "stat"; label: string; value: string }
  | { type: "section"; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "insight"; text: string };

export type CalcPdfInput = {
  firmName: string;
  arn?: string | null;
  preparedBy?: string | null;
  clientName?: string | null;
  calcName: string;
  blocks: PdfBlock[];
  logoBytes?: Uint8Array | null;
  primaryHex?: string | null;
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
// pdf-lib's standard fonts are WinAnsi-encoded and can't draw ₹ (U+20B9) — the
// old regex KEPT ₹ (it was in the negated class) so drawText threw. Convert
// ₹ → "Rs " FIRST, normalise a few punctuation glyphs, then strip non-ASCII.
const ascii = (s: string) =>
  (s ?? "")
    .replace(/₹/g, "Rs ")
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function hexToRgb(hex?: string | null) {
  const h = (hex ?? "#0e2557").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Word-wrap `text` to `maxWidth` at `size`, returns lines. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = ascii(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderCalcPdf(input: CalcPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const primary = hexToRgb(input.primaryHex);
  const slate = rgb(0.39, 0.45, 0.55);
  const ink = rgb(0.06, 0.09, 0.16);

  let logo: PDFImage | null = null;
  if (input.logoBytes && input.logoBytes.length) {
    try { logo = await doc.embedPng(input.logoBytes); } catch { try { logo = await doc.embedJpg(input.logoBytes); } catch { logo = null; } }
  }

  doc.setTitle(ascii(`${input.clientName || "Client"} - ${input.calcName} - ${input.firmName}`));
  doc.setProducer("Aina CRM");

  const W = A4[0], H = A4[1];
  const contentW = W - MARGIN * 2;
  let page: PDFPage = doc.addPage(A4);
  let y = H - MARGIN;

  // Multi-page: when a block won't fit above the footer band we spill onto a
  // fresh page so EVERY captured row/stat/insight makes it into the PDF (the
  // calculators with long year-by-year tables need 2-3 pages — that's fine).
  const newPage = () => { page = doc.addPage(A4); y = H - MARGIN; };
  const need = (h: number) => { if (y - h < MARGIN + 30) newPage(); };

  // ── Letterhead ── The logo already carries the firm's name, so when it's
  // present we show ONLY the logo here (no redundant text beside it). The firm
  // name + ARN still appear once, in the footer. Without a logo we fall back to
  // the firm name + ARN as text.
  if (logo) {
    const boxW = 175, boxH = 40;
    const scale = Math.min(boxW / logo.width, boxH / logo.height);
    const w = logo.width * scale, h = logo.height * scale;
    page.drawImage(logo, { x: MARGIN, y: y - h, width: w, height: h });
  } else {
    page.drawText(ascii(input.firmName), { x: MARGIN, y: y - 14, size: 14, font: bold, color: ink });
    page.drawText(ascii(`ARN ${input.arn ?? "-"}`), { x: MARGIN, y: y - 28, size: 9, font, color: slate });
  }
  page.drawText("Investment Illustration", { x: W - MARGIN - 130, y: y - 14, size: 11, font: bold, color: primary });
  const dt = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  page.drawText(ascii(`Prepared ${dt}`), { x: W - MARGIN - 130, y: y - 27, size: 9, font, color: slate });
  y -= 46;
  page.drawRectangle({ x: MARGIN, y, width: contentW, height: 3, color: primary });
  y -= 18;

  // ── Title + client ──
  page.drawText(ascii(input.calcName), { x: MARGIN, y: y - 6, size: 16, font: bold, color: ink });
  y -= 22;
  if (input.clientName) {
    page.drawText(ascii(`Prepared for: ${input.clientName}`), { x: MARGIN, y, size: 11, font, color: slate });
    y -= 18;
  }
  y -= 4;

  // ── Blocks (paginates — every row/stat/insight always makes it in) ──
  let i = 0;
  while (i < input.blocks.length) {
    const b = input.blocks[i];
    if (b.type === "stat") {
      // Batch consecutive stats into rows of 3 cards.
      const group: { label: string; value: string }[] = [];
      while (i < input.blocks.length && input.blocks[i].type === "stat") { group.push(input.blocks[i] as any); i++; }
      const cols = 3, cw = contentW / cols, ch = 38;
      for (let g = 0; g < group.length; g += cols) {
        need(ch + 8);
        const row = group.slice(g, g + cols);
        row.forEach((s, c) => {
          const x = MARGIN + c * cw;
          page.drawRectangle({ x, y: y - ch, width: cw - 8, height: ch, borderColor: rgb(0.89, 0.91, 0.94), borderWidth: 1, color: rgb(0.98, 0.99, 1) });
          page.drawText(ascii(s.label).slice(0, 34), { x: x + 8, y: y - 13, size: 7.5, font, color: slate });
          page.drawText(ascii(s.value).slice(0, 22), { x: x + 8, y: y - 29, size: 12, font: bold, color: ink });
        });
        y -= ch + 8;
      }
      continue;
    }
    if (b.type === "section") {
      need(26);
      y -= 6;
      page.drawText(ascii(b.text), { x: MARGIN, y: y - 10, size: 11, font: bold, color: primary });
      y -= 20;
      i++; continue;
    }
    if (b.type === "insight") {
      const lines = wrap(ascii(b.text), font, 9, contentW - 16);
      const boxH = lines.length * 12 + 10;
      need(boxH + 8);
      page.drawRectangle({ x: MARGIN, y: y - boxH, width: contentW, height: boxH, color: rgb(0.94, 0.99, 0.96), borderColor: rgb(0.78, 0.92, 0.83), borderWidth: 1 });
      lines.forEach((ln, k) => page.drawText(ln, { x: MARGIN + 8, y: y - 14 - k * 12, size: 9, font, color: rgb(0.1, 0.3, 0.18) }));
      y -= boxH + 8;
      i++; continue;
    }
    if (b.type === "table") {
      const head = b.head.map(ascii);
      const colW = contentW / Math.max(1, head.length);
      // Draw (or redraw, after a page break) the header band, then rows. A long
      // table that crosses a page boundary repeats its header on the next page.
      const drawHeader = () => {
        page.drawRectangle({ x: MARGIN, y: y - 16, width: contentW, height: 16, color: rgb(0.95, 0.96, 0.98) });
        head.forEach((h, c) => page.drawText(ascii(h).slice(0, 26), { x: MARGIN + 4 + c * colW, y: y - 12, size: 7.5, font: bold, color: slate }));
        y -= 16;
      };
      need(30);
      drawHeader();
      for (const row of b.rows) {
        if (y - 14 < MARGIN + 30) { newPage(); drawHeader(); }
        row.slice(0, head.length).forEach((cell, c) => {
          page.drawText(ascii(cell).slice(0, 26), { x: MARGIN + 4 + c * colW, y: y - 11, size: 8, font, color: ink });
        });
        page.drawLine({ start: { x: MARGIN, y: y - 14 }, end: { x: W - MARGIN, y: y - 14 }, thickness: 0.3, color: rgb(0.9, 0.92, 0.95) });
        y -= 14;
      }
      y -= 8;
      i++; continue;
    }
    i++;
  }

  // ── Footer disclaimer on every page ──
  const disc = "Illustration only; not a guarantee of returns. Mutual fund investments are subject to market risks. Read all scheme related documents carefully.";
  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 18 }, end: { x: W - MARGIN, y: MARGIN + 18 }, thickness: 0.5, color: rgb(0.89, 0.91, 0.94) });
    wrap(disc, font, 7, contentW).forEach((ln, k) => p.drawText(ln, { x: MARGIN, y: MARGIN + 8 - k * 8, size: 7, font, color: slate }));
    p.drawText(ascii(`${input.firmName} - ARN ${input.arn ?? "-"}`), { x: MARGIN, y: MARGIN + 24, size: 7, font, color: slate });
    p.drawText(`${idx + 1}/${pages.length}`, { x: W - MARGIN - 20, y: MARGIN + 24, size: 7, font, color: slate });
  });

  return Buffer.from(await doc.save());
}
