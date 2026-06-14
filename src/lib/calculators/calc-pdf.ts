/**
 * calc-pdf — render a professional A4 calculator report (single calculator) OR a
 * combined multi-calculator client report, from captured inputs + result blocks.
 * Built with pdf-lib (Node runtime). Used by the calculator Download / Email /
 * WhatsApp paths and the "combined report" tray.
 *
 * Every page carries the firm header band (page 1) and a footer band (firm
 * disclaimer + "Page X of Y") on every page. Content flows strictly between the
 * bands; long tables paginate and repeat their header; charts never split.
 * A combined report adds a cover (title + client/advisor + contents list) and
 * starts each calculator on its own page with a numbered heading.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

export type PdfBlock =
  | { type: "stat"; label: string; value: string }
  | { type: "section"; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "insight"; text: string }
  | { type: "image"; dataUrl: string; w?: number; h?: number };

/** Firm + client branding common to single and combined reports. */
type ReportCommon = {
  firmName: string;
  arn?: string | null;
  preparedBy?: string | null;
  firmPhone?: string | null;
  firmEmail?: string | null;
  firmWebsite?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientMobile?: string | null;
  logoBytes?: Uint8Array | null;
  primaryHex?: string | null;
  generatedAt?: string | null;
};

/** One calculator's captured payload. */
export type CalcItem = {
  calcName: string;
  inputs?: { label: string; value: string; group?: string }[];
  blocks: PdfBlock[];
};

export type CalcPdfInput = ReportCommon & {
  calcName: string;
  inputs?: { label: string; value: string; group?: string }[];
  blocks: PdfBlock[];
};

export type CombinedCalcPdfInput = ReportCommon & {
  reportTitle?: string | null;
  items: CalcItem[];
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const HEADER_H = 86;
const FOOTER_H = 50;

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

function clip(text: string, font: PDFFont, size: number, maxWidth: number): string {
  let s = ascii(text);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > maxWidth) s = s.slice(0, -1);
  return s + "...";
}

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

/** Shared renderer for single + combined reports. */
async function renderReport(
  c: ReportCommon,
  items: CalcItem[],
  opts: { title: string; ctxLabel: string; combined: boolean }
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const primary = hexToRgb(c.primaryHex);
  const slate = rgb(0.42, 0.47, 0.55);
  const ink = rgb(0.1, 0.13, 0.18);
  const line = rgb(0.85, 0.87, 0.9);
  const zebra = rgb(0.97, 0.98, 0.99);

  let logo: PDFImage | null = null;
  if (c.logoBytes && c.logoBytes.length) {
    try { logo = await doc.embedPng(c.logoBytes); }
    catch { try { logo = await doc.embedJpg(c.logoBytes); } catch { logo = null; } }
  }

  doc.setTitle(ascii(`${opts.title} - ${c.clientName || "Client"} - ${c.firmName}`));
  doc.setProducer("Aina CRM");

  const W = A4[0], H = A4[1];
  const contentW = W - MARGIN * 2;
  const TOP1 = H - HEADER_H;
  const TOP2 = H - MARGIN;
  const BOTTOM = FOOTER_H;
  const fullPageH = TOP2 - BOTTOM;

  let page: PDFPage = doc.addPage(A4);
  let y = TOP1;

  const newPage = () => { page = doc.addPage(A4); y = TOP2; };
  const need = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const keepTogether = (h: number) => { if (h <= fullPageH && y - h < BOTTOM) newPage(); };
  const estTableHeight = (head: string[], rows: string[][]) => (head.length ? 24 : 0) + rows.length * 15 + 10;
  const drawRight = (p: PDFPage, t: string, xRight: number, yy: number, size: number, f: PDFFont, col = ink) => {
    const s = ascii(t);
    p.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color: col });
  };
  const drawCenter = (p: PDFPage, t: string, yy: number, size: number, f: PDFFont, col = ink) => {
    const s = ascii(t);
    p.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y: yy, size, font: f, color: col });
  };
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

  // ── content drawers ──
  const sectionHead = (text: string) => {
    need(26);
    y -= 4;
    page.drawRectangle({ x: MARGIN, y: y - 14, width: 3, height: 13, color: primary });
    page.drawText(ascii(text), { x: MARGIN + 9, y: y - 11, size: 11, font: bold, color: ink });
    y -= 22;
  };
  // Combined-report per-calculator banner (filled bar) — always starts a page.
  const itemHeading = (n: number, name: string) => {
    page.drawRectangle({ x: MARGIN, y: y - 26, width: contentW, height: 26, color: primary });
    page.drawText(ascii(`${n}. ${name}`), { x: MARGIN + 12, y: y - 18, size: 13, font: bold, color: rgb(1, 1, 1) });
    y -= 38;
  };
  const drawStats = (group: { label: string; value: string }[]) => {
    const cols = 3, cw = contentW / cols, ch = 40;
    for (let g = 0; g < group.length; g += cols) {
      need(ch + 8);
      const row = group.slice(g, g + cols);
      row.forEach((s, col) => {
        const x = MARGIN + col * cw;
        page.drawRectangle({ x, y: y - ch, width: cw - 8, height: ch, borderColor: line, borderWidth: 1, color: rgb(0.985, 0.99, 1) });
        page.drawText(clip(s.label, font, 7.5, cw - 24), { x: x + 8, y: y - 14, size: 7.5, font, color: slate });
        page.drawText(clip(s.value, bold, 12, cw - 24), { x: x + 8, y: y - 30, size: 12, font: bold, color: ink });
      });
      y -= ch + 8;
    }
  };
  const drawTable = (head: string[], rows: string[][]) => {
    const ncol = Math.max(head.length, ...rows.map((r) => r.length), 1);
    const weights = Array.from({ length: ncol }, (_, i) => (i === 0 ? (ncol <= 3 ? 1.6 : 1.15) : 1));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const colX: number[] = [];
    let acc = MARGIN;
    const colW2 = weights.map((w) => (w / wsum) * contentW);
    colW2.forEach((w) => { colX.push(acc); acc += w; });
    const cellPad = 4;
    const rowH = 15;
    const hSize = 7;
    const headLines = head.map((h, col) => wrap(h, bold, hSize, colW2[col] - cellPad * 2).slice(0, 2));
    const headH = head.length ? Math.max(rowH, Math.max(1, ...headLines.map((l) => l.length)) * 9 + 6) : 0;
    keepTogether(headH + rows.length * rowH + 8);
    const drawHeader = () => {
      need(headH + 4);
      page.drawRectangle({ x: MARGIN, y: y - headH, width: contentW, height: headH, color: rgb(0.93, 0.95, 0.97) });
      headLines.forEach((lines, col) => {
        const align = col === 0 ? "left" : "right";
        lines.forEach((s, li) => {
          const tx = align === "left" ? colX[col] + cellPad : colX[col] + colW2[col] - cellPad - bold.widthOfTextAtSize(s, hSize);
          page.drawText(s, { x: tx, y: y - 11 - li * 9, size: hSize, font: bold, color: slate });
        });
      });
      y -= headH;
    };
    if (head.length) drawHeader();
    rows.forEach((row, ri) => {
      if (y - rowH < BOTTOM) { newPage(); if (head.length) drawHeader(); }
      if (ri % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - rowH, width: contentW, height: rowH, color: zebra });
      for (let col = 0; col < ncol; col++) {
        const cell = row[col] ?? "";
        const align = col === 0 ? "left" : "right";
        const s = clip(cell, font, 8, colW2[col] - cellPad * 2);
        const tx = align === "left" ? colX[col] + cellPad : colX[col] + colW2[col] - cellPad - font.widthOfTextAtSize(s, 8);
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
  const drawInputs = (inputs: { label: string; value: string; group?: string }[]) => {
    sectionHead("Input Details");
    const order: string[] = [];
    const byGroup = new Map<string, { label: string; value: string }[]>();
    for (const it of inputs) {
      const g = it.group || "";
      if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
      byGroup.get(g)!.push(it);
    }
    for (const g of order) {
      const gRows = byGroup.get(g)!.map((i) => [i.label, i.value]);
      if (g) {
        keepTogether(16 + Math.min(estTableHeight(["Field", "Value"], gRows), fullPageH - 16));
        page.drawText(ascii(g), { x: MARGIN, y: y - 10, size: 9, font: bold, color: primary });
        y -= 16;
      }
      drawTable(["Field", "Value"], gRows);
    }
  };
  const drawBlocks = async (blocks: PdfBlock[]) => {
    let resultsHeaderDrawn = false;
    let i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      if (b.type === "stat") {
        if (!resultsHeaderDrawn) { sectionHead("Results & Summary"); resultsHeaderDrawn = true; }
        const group: { label: string; value: string }[] = [];
        while (i < blocks.length && blocks[i].type === "stat") {
          const s = blocks[i] as Extract<PdfBlock, { type: "stat" }>;
          group.push({ label: s.label, value: s.value });
          i++;
        }
        drawStats(group);
        continue;
      }
      if (b.type === "section") {
        const next = blocks[i + 1];
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
            keepTogether(h + 10);
            page.drawImage(png, { x: MARGIN + (contentW - w) / 2, y: y - h, width: w, height: h });
            y -= h + 10;
          }
        } catch { /* skip an unembeddable image */ }
        i++; continue;
      }
      i++;
    }
  };

  // ════════════════ COVER / PAGE 1 ════════════════
  need(30);
  drawCenter(page, opts.title, y - 16, 18, bold, ink);
  y -= 30;

  const advisorPairs: [string, string][] = [
    ["Firm:", c.firmName],
    ["Advisor:", c.preparedBy || ""],
    ["ARN:", (c.arn || "").replace(/^ARN[-\s]*/i, "")],
  ];
  const clientPairs: [string, string][] = [
    ["Name:", c.clientName || "-"],
    ["Report date:", c.generatedAt || new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })],
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

  // Combined: contents list on the cover.
  if (opts.combined && items.length > 1) {
    sectionHead("Included in this report");
    drawTable(["#", "Calculator"], items.map((it, i) => [String(i + 1), it.calcName]));
  }

  // ════════════════ EACH CALCULATOR ════════════════
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (opts.combined) { newPage(); itemHeading(idx + 1, item.calcName); }
    if (item.inputs && item.inputs.length) drawInputs(item.inputs);
    await drawBlocks(item.blocks);
  }

  // ════════════════ NOTES (once) ════════════════
  need(40);
  sectionHead("Notes & Assumptions");
  wrap(
    "All figures are projections based on the inputs above and the stated rate of return, which is not assured. " +
      "Actual results will vary with market performance, fund selection, costs and taxes.",
    font, 8.5, contentW
  ).forEach((ln) => { page.drawText(ln, { x: MARGIN, y: y - 4, size: 8.5, font, color: slate }); y -= 12; });

  // ════════════════ HEADER + FOOTER ════════════════
  const dt = c.generatedAt || new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const ctx = ascii(opts.ctxLabel);
  const ruleY = H - 54;
  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    if (idx === 0) {
      if (logo) {
        const boxW = 160, boxH2 = 32;
        const scale = Math.min(boxW / logo.width, boxH2 / logo.height);
        p.drawImage(logo, { x: MARGIN, y: H - 16 - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
      } else {
        p.drawText(ascii(c.firmName), { x: MARGIN, y: H - 30, size: 13, font: bold, color: ink });
      }
      drawRight(p, ascii(c.arn ?? "-"), W - MARGIN, H - 22, 9, bold, ink);
      drawRight(p, `Generated: ${dt}`, W - MARGIN, H - 35, 8, font, slate);
      p.drawLine({ start: { x: MARGIN, y: ruleY }, end: { x: W - MARGIN, y: ruleY }, thickness: 1, color: primary });
      p.drawText(clip(ctx, font, 8, contentW), { x: MARGIN, y: ruleY - 12, size: 8, font, color: slate });
    }
    p.drawLine({ start: { x: MARGIN, y: FOOTER_H - 2 }, end: { x: W - MARGIN, y: FOOTER_H - 2 }, thickness: 0.6, color: line });
    drawRight(p, `Page ${idx + 1} of ${pages.length}`, W - MARGIN, FOOTER_H - 14, 7.5, bold, slate);
    wrap(DISCLAIMER, font, 6.5, contentW).slice(0, 2).forEach((ln, k) =>
      p.drawText(ln, { x: MARGIN, y: FOOTER_H - 24 - k * 8, size: 6.5, font, color: slate })
    );
  });

  return Buffer.from(await doc.save());
}

/** Single-calculator report (Download / Email / WhatsApp). */
export async function renderCalcPdf(input: CalcPdfInput): Promise<Buffer> {
  return renderReport(
    input,
    [{ calcName: input.calcName, inputs: input.inputs, blocks: input.blocks }],
    {
      title: `${input.calcName} Report`,
      ctxLabel: `${input.calcName} Report` + (input.clientName ? `  -  ${input.clientName}` : ""),
      combined: false,
    }
  );
}

/** Combined multi-calculator client report (the report tray). */
export async function renderCombinedCalcPdf(input: CombinedCalcPdfInput): Promise<Buffer> {
  const title = input.reportTitle || `${input.clientName ? input.clientName + " - " : ""}Financial Plan`;
  const ctxLabel = title + (input.clientName && !title.includes(input.clientName) ? `  -  ${input.clientName}` : "");
  return renderReport(input, input.items, { title, ctxLabel, combined: true });
}
