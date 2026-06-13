/**
 * calc-pdf — render a complete, professional A4 calculator report from a
 * captured calculator (title + inputs + result blocks). Built with pdf-lib
 * (Node runtime). Used by the calculator Download / Email / WhatsApp paths.
 *
 * The report is fully paginated and EVERY page carries the firm header band
 * (logo, firm, ARN, generated date, calculator + client context) and the
 * footer band (firm/ARN, disclaimer, "Page X of Y"). Content flows strictly
 * between the two bands so nothing overlaps. Long result tables continue onto
 * the next page and repeat their column header. Sections rendered in order:
 *   1. Report title (centred)         4. Input details (table)
 *   2. Client & advisor details box   5. Results (cards / sections / tables)
 *   3. (header/footer on every page)  6. Notes & assumptions
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

export type PdfBlock =
  | { type: "stat"; label: string; value: string }
  | { type: "section"; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "insight"; text: string }
  | { type: "image"; dataUrl: string; w?: number; h?: number };

export type CalcPdfInput = {
  firmName: string;
  arn?: string | null;
  preparedBy?: string | null;
  firmPhone?: string | null;
  firmEmail?: string | null;
  firmWebsite?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientMobile?: string | null;
  calcName: string;
  inputs?: { label: string; value: string; group?: string }[];
  blocks: PdfBlock[];
  logoBytes?: Uint8Array | null;
  primaryHex?: string | null;
  /** Human-readable generated timestamp (server builds it in IST). */
  generatedAt?: string | null;
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const HEADER_H = 86; // reserved top band (header drawn here, every page)
const FOOTER_H = 50; // reserved bottom band (footer drawn here, every page)

// pdf-lib's standard fonts are WinAnsi-encoded and can't draw ₹ (U+20B9) — map
// it to "Rs ", normalise a few punctuation glyphs, then strip non-ASCII.
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
  if (!Number.isFinite(n)) return rgb(0.06, 0.09, 0.16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Trim `text` to fit `maxWidth` at `size`, adding an ellipsis if cut. */
function clip(text: string, font: PDFFont, size: number, maxWidth: number): string {
  let s = ascii(text);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > maxWidth) s = s.slice(0, -1);
  return s + "...";
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

const DISCLAIMER =
  "This report is for illustration purposes only and is not a guarantee of returns. " +
  "Calculations are based on the inputs and assumptions provided. Mutual fund investments are " +
  "subject to market risks; read all scheme related documents carefully.";

export async function renderCalcPdf(input: CalcPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const primary = hexToRgb(input.primaryHex);
  const slate = rgb(0.42, 0.47, 0.55);
  const ink = rgb(0.1, 0.13, 0.18);
  const line = rgb(0.85, 0.87, 0.9);
  const zebra = rgb(0.97, 0.98, 0.99);

  let logo: PDFImage | null = null;
  if (input.logoBytes && input.logoBytes.length) {
    try { logo = await doc.embedPng(input.logoBytes); }
    catch { try { logo = await doc.embedJpg(input.logoBytes); } catch { logo = null; } }
  }

  doc.setTitle(ascii(`${input.calcName} Report - ${input.clientName || "Client"} - ${input.firmName}`));
  doc.setProducer("Aina CRM");

  const W = A4[0], H = A4[1];
  const contentW = W - MARGIN * 2;
  // Header band appears on page 1 ONLY. Page 1 content starts below it; pages
  // 2+ have no header, so content starts at the top margin and uses that space.
  const TOP1 = H - HEADER_H;       // page 1 ceiling (below header band)
  const TOP2 = H - MARGIN;         // page 2+ ceiling (no header)
  const BOTTOM = FOOTER_H;         // content floor (above footer band, every page)
  const fullPageH = TOP2 - BOTTOM; // max content height on a header-less page

  let page: PDFPage = doc.addPage(A4);
  let y = TOP1;

  const newPage = () => { page = doc.addPage(A4); y = TOP2; };
  const need = (h: number) => { if (y - h < BOTTOM) newPage(); };
  // Move to a fresh page if `h` won't fit here but WOULD fit on a full page —
  // keeps a small table (or a section + its table) from being split awkwardly.
  const keepTogether = (h: number) => { if (h <= fullPageH && y - h < BOTTOM) newPage(); };
  const estTableHeight = (head: string[], rows: string[][]) =>
    (head.length ? 24 : 0) + rows.length * 15 + 10;
  const drawRight = (p: PDFPage, t: string, xRight: number, yy: number, size: number, f: PDFFont, c = ink) => {
    const s = ascii(t);
    p.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color: c });
  };
  const drawCenter = (p: PDFPage, t: string, yy: number, size: number, f: PDFFont, c = ink) => {
    const s = ascii(t);
    p.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y: yy, size, font: f, color: c });
  };

  // ── helper: a label/value mini-table cell grid for the details box ──
  const kvLines = (pairs: [string, string][], x: number, startY: number, colW: number) => {
    let yy = startY;
    for (const [k, v] of pairs) {
      if (!v) continue;
      page.drawText(ascii(k), { x, y: yy, size: 8, font: bold, color: slate });
      const kW = bold.widthOfTextAtSize(ascii(k) + " ", 8);
      page.drawText(clip(v, font, 9, colW - kW), { x: x + kW, y: yy, size: 9, font, color: ink });
      yy -= 14;
    }
    return yy;
  };

  // ════════════════ PAGE 1 CONTENT ════════════════

  // 1. Report title (centred). Firm name is already in the logo/header, so no
  //    duplicate subtitle here.
  need(30);
  drawCenter(page, `${input.calcName} Report`, y - 16, 18, bold, ink);
  y -= 30;

  // 2. Client & Advisor details box (two columns)
  const advisorPairs: [string, string][] = [
    ["Firm:", input.firmName],
    ["Advisor:", input.preparedBy || ""],
    ["ARN:", (input.arn || "").replace(/^ARN[-\s]*/i, "")],
  ];
  const clientPairs: [string, string][] = [
    ["Name:", input.clientName || "-"],
    ["Report date:", input.generatedAt || new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })],
  ];
  const boxRows = Math.max(advisorPairs.filter((p) => p[1]).length, clientPairs.filter((p) => p[1]).length);
  const boxH = 22 + boxRows * 14;
  need(boxH + 10);
  page.drawRectangle({ x: MARGIN, y: y - boxH, width: contentW, height: boxH, borderColor: line, borderWidth: 1, color: rgb(0.985, 0.99, 0.995) });
  const colW = (contentW - 24) / 2;
  page.drawText("ADVISOR", { x: MARGIN + 12, y: y - 14, size: 8, font: bold, color: primary });
  page.drawText("CLIENT", { x: MARGIN + 12 + colW + 12, y: y - 14, size: 8, font: bold, color: primary });
  kvLines(advisorPairs, MARGIN + 12, y - 30, colW - 12);
  kvLines(clientPairs, MARGIN + 12 + colW + 12, y - 30, colW - 12);
  y -= boxH + 16;

  // ── section / stats / table / insight drawers ──
  const sectionHead = (text: string) => {
    need(26);
    y -= 4;
    page.drawRectangle({ x: MARGIN, y: y - 14, width: 3, height: 13, color: primary });
    page.drawText(ascii(text), { x: MARGIN + 9, y: y - 11, size: 11, font: bold, color: ink });
    y -= 22;
  };

  const drawStats = (group: { label: string; value: string }[]) => {
    const cols = 3, cw = contentW / cols, ch = 40;
    for (let g = 0; g < group.length; g += cols) {
      need(ch + 8);
      const row = group.slice(g, g + cols);
      row.forEach((s, c) => {
        const x = MARGIN + c * cw;
        page.drawRectangle({ x, y: y - ch, width: cw - 8, height: ch, borderColor: line, borderWidth: 1, color: rgb(0.985, 0.99, 1) });
        page.drawText(clip(s.label, font, 7.5, cw - 24), { x: x + 8, y: y - 14, size: 7.5, font, color: slate });
        page.drawText(clip(s.value, bold, 12, cw - 24), { x: x + 8, y: y - 30, size: 12, font: bold, color: ink });
      });
      y -= ch + 8;
    }
  };

  const drawTable = (head: string[], rows: string[][]) => {
    const ncol = Math.max(head.length, ...rows.map((r) => r.length), 1);
    // First column (labels) is wider for narrow tables (Field/Value), near-even
    // for many-column data tables so every column has room.
    const weights = Array.from({ length: ncol }, (_, i) => (i === 0 ? (ncol <= 3 ? 1.6 : 1.15) : 1));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const colX: number[] = [];
    let acc = MARGIN;
    const colW2 = weights.map((w) => (w / wsum) * contentW);
    colW2.forEach((w) => { colX.push(acc); acc += w; });
    const cellPad = 4;
    const rowH = 15;

    // Wrap header labels to ≤2 lines so wide tables don't crop column names.
    const hSize = 7;
    const headLines = head.map((h, c) => wrap(h, bold, hSize, colW2[c] - cellPad * 2).slice(0, 2));
    const headH = head.length ? Math.max(rowH, Math.max(1, ...headLines.map((l) => l.length)) * 9 + 6) : 0;

    // Keep the whole table on one page when it fits; only tables taller than a
    // full page are split (and then the header repeats on each continuation).
    keepTogether(headH + rows.length * rowH + 8);

    const drawHeader = () => {
      need(headH + 4);
      page.drawRectangle({ x: MARGIN, y: y - headH, width: contentW, height: headH, color: rgb(0.93, 0.95, 0.97) });
      headLines.forEach((lines, c) => {
        const align = c === 0 ? "left" : "right";
        lines.forEach((s, li) => {
          const tx = align === "left" ? colX[c] + cellPad : colX[c] + colW2[c] - cellPad - bold.widthOfTextAtSize(s, hSize);
          page.drawText(s, { x: tx, y: y - 11 - li * 9, size: hSize, font: bold, color: slate });
        });
      });
      y -= headH;
    };

    if (head.length) drawHeader();
    rows.forEach((row, ri) => {
      if (y - rowH < BOTTOM) { newPage(); if (head.length) drawHeader(); }
      if (ri % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - rowH, width: contentW, height: rowH, color: zebra });
      for (let c = 0; c < ncol; c++) {
        const cell = row[c] ?? "";
        const align = c === 0 ? "left" : "right";
        const s = clip(cell, font, 8, colW2[c] - cellPad * 2);
        const tx = align === "left" ? colX[c] + cellPad : colX[c] + colW2[c] - cellPad - font.widthOfTextAtSize(s, 8);
        page.drawText(s, { x: tx, y: y - 11, size: 8, font, color: ink });
      }
      page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: W - MARGIN, y: y - rowH }, thickness: 0.3, color: line });
      y -= rowH;
    });
    y -= 8;
  };

  const drawInsight = (text: string) => {
    const lines = wrap(text, font, 8.5, contentW - 16);
    const ih = lines.length * 11 + 10;
    need(ih + 6);
    page.drawRectangle({ x: MARGIN, y: y - ih, width: contentW, height: ih, color: rgb(0.95, 0.985, 0.97), borderColor: rgb(0.8, 0.92, 0.85), borderWidth: 1 });
    lines.forEach((ln, k) => page.drawText(ln, { x: MARGIN + 8, y: y - 13 - k * 11, size: 8.5, font, color: rgb(0.1, 0.3, 0.18) }));
    y -= ih + 8;
  };

  // 3. Input details — grouped under their category headings so identically
  //    labelled fields (e.g. Debt/Hybrid/Equity allocation vs returns) are clear.
  if (input.inputs && input.inputs.length) {
    sectionHead("Input Details");
    const order: string[] = [];
    const byGroup = new Map<string, { label: string; value: string }[]>();
    for (const it of input.inputs) {
      const g = it.group || "";
      if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
      byGroup.get(g)!.push(it);
    }
    for (const g of order) {
      const gRows = byGroup.get(g)!.map((i) => [i.label, i.value]);
      if (g) {
        // keep the category heading with (at least the top of) its table
        keepTogether(16 + Math.min(estTableHeight(["Field", "Value"], gRows), fullPageH - 16));
        page.drawText(ascii(g), { x: MARGIN, y: y - 10, size: 9, font: bold, color: primary });
        y -= 16;
      }
      drawTable(["Field", "Value"], gRows);
    }
  }

  // 4. Results — render blocks in order, batching consecutive stat cards.
  let resultsHeaderDrawn = false;
  let i = 0;
  while (i < input.blocks.length) {
    const b = input.blocks[i];
    if (b.type === "stat") {
      if (!resultsHeaderDrawn) { sectionHead("Results & Summary"); resultsHeaderDrawn = true; }
      const group: { label: string; value: string }[] = [];
      while (i < input.blocks.length && input.blocks[i].type === "stat") {
        const s = input.blocks[i] as Extract<PdfBlock, { type: "stat" }>;
        group.push({ label: s.label, value: s.value });
        i++;
      }
      drawStats(group);
      continue;
    }
    if (b.type === "section") {
      // keep a section heading together with the table/cards that follow it
      const next = input.blocks[i + 1];
      let withH = 22;
      if (next?.type === "table") withH += estTableHeight(next.head, next.rows);
      else if (next?.type === "stat") withH += 48;
      keepTogether(Math.min(withH, fullPageH));
      sectionHead(b.text); i++; continue;
    }
    if (b.type === "table") { drawTable(b.head, b.rows); i++; continue; }
    if (b.type === "insight") { drawInsight(b.text); i++; continue; }
    if (b.type === "image") {
      try {
        const b64 = (b.dataUrl.split(",")[1] || "");
        if (b64) {
          const png = await doc.embedPng(Buffer.from(b64, "base64"));
          let w = contentW;
          let h = (png.height / png.width) * contentW;
          const maxH = fullPageH - 16;
          if (h > maxH) { const s = maxH / h; w *= s; h *= s; }
          keepTogether(h + 10); // never split a chart across pages
          page.drawImage(png, { x: MARGIN + (contentW - w) / 2, y: y - h, width: w, height: h });
          y -= h + 10;
        }
      } catch { /* skip an unembeddable image */ }
      i++; continue;
    }
    i++;
  }

  // 5. Notes & assumptions
  need(40);
  sectionHead("Notes & Assumptions");
  wrap(
    "All figures are projections based on the inputs above and the stated rate of return, which is not assured. " +
      "Actual results will vary with market performance, fund selection, costs and taxes.",
    font, 8.5, contentW
  ).forEach((ln) => { page.drawText(ln, { x: MARGIN, y: y - 4, size: 8.5, font, color: slate }); y -= 12; });

  // ════════════════ HEADER + FOOTER on EVERY page ════════════════
  const dt = input.generatedAt || new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const ctx = ascii(`${input.calcName} Report` + (input.clientName ? `  -  ${input.clientName}` : ""));
  const ruleY = H - 54; // header divider; logo sits above it, context below it
  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    // ── Header band — PAGE 1 ONLY. The logo already carries the firm name, so
    //    the right column shows just the ARN (value already includes "ARN-",
    //    so no "ARN:" prefix) and the generated timestamp — no duplication.
    if (idx === 0) {
      if (logo) {
        const boxW = 160, boxH2 = 32;
        const scale = Math.min(boxW / logo.width, boxH2 / logo.height);
        p.drawImage(logo, { x: MARGIN, y: H - 16 - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
      } else {
        p.drawText(ascii(input.firmName), { x: MARGIN, y: H - 30, size: 13, font: bold, color: ink });
      }
      drawRight(p, ascii(input.arn ?? "-"), W - MARGIN, H - 22, 9, bold, ink);
      drawRight(p, `Generated: ${dt}`, W - MARGIN, H - 35, 8, font, slate);
      p.drawLine({ start: { x: MARGIN, y: ruleY }, end: { x: W - MARGIN, y: ruleY }, thickness: 1, color: primary });
      p.drawText(clip(ctx, font, 8, contentW), { x: MARGIN, y: ruleY - 12, size: 8, font, color: slate });
    }

    // ── Footer band — every page: page number + disclaimer (no firm/ARN dup).
    p.drawLine({ start: { x: MARGIN, y: FOOTER_H - 2 }, end: { x: W - MARGIN, y: FOOTER_H - 2 }, thickness: 0.6, color: line });
    drawRight(p, `Page ${idx + 1} of ${pages.length}`, W - MARGIN, FOOTER_H - 14, 7.5, bold, slate);
    wrap(DISCLAIMER, font, 6.5, contentW).slice(0, 2).forEach((ln, k) =>
      p.drawText(ln, { x: MARGIN, y: FOOTER_H - 24 - k * 8, size: 6.5, font, color: slate })
    );
  });

  return Buffer.from(await doc.save());
}
