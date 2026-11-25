/**
 * Client master PDF — the layout. SERVER-ONLY, pure pdf-lib (same stack, fonts and
 * letterhead as the portfolio statement). The data comes from ./load.ts.
 *
 * Page order: Client Master (flows over as many pages as it needs) → Portfolio →
 * Fixed deposits → Cross-sell holdings → Review details → [Meetings · Service
 * requests · Tasks · Emails · Gifts — only the ones asked for, one section each]
 * → Notes, always last. A section that runs past a page continues under the slim
 * "(continued)" header, and a table repeats its heading row.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { drawContinuationHeader, drawPageNumbers, drawReportHeader } from "@/lib/pdf/report-header";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import { embedLogo, hexToRgb } from "@/lib/finance/valuation-pdf";
import { OPTIONAL_KEYS, type ClientMasterData, type PdfCell, type PdfKv, type PdfTable } from "./types";

const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.4, 0.45, 0.53);
const LINE: RGB = rgb(0.89, 0.91, 0.94);
const HEAD_BG: RGB = rgb(0.945, 0.957, 0.973);
const TILE_BG: RGB = rgb(0.97, 0.98, 0.99);
const GOOD: RGB = rgb(0.02, 0.47, 0.34);
const WARN: RGB = rgb(0.71, 0.33, 0.04);
const BAD: RGB = rgb(0.72, 0.11, 0.11);
const ACCENT: RGB = rgb(0.055, 0.647, 0.914);
const ALLOC_COLOURS: RGB[] = [rgb(0.055, 0.145, 0.341), rgb(0.055, 0.647, 0.914), rgb(0.49, 0.77, 0.91), rgb(0.88, 0.65, 0.15), rgb(0.6, 0.6, 0.65)];

const W = 595.28;
const H = 841.89;
const M = 40;
const BOTTOM = 72; // content floor — the footer band sits below it
const USABLE = W - 2 * M;

export async function renderClientMasterPdf(d: ClientMasterData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const { font, bold, rupeeOk } = await embedPdfFonts(doc);
  // A masked number arrives as bullets ("••••4821"); the PDF's font has them, the sanitiser does not.
  const san = (s: string) => pdfSanitize(String(s ?? "").replace(/•/g, "X"), rupeeOk);
  const primary = hexToRgb(d.brand.primaryColor);
  const secondary = d.brand.secondaryColor ? hexToRgb(d.brand.secondaryColor) : ACCENT;
  const firm = d.brand.legalName ?? d.brand.displayName ?? "Your Advisor";
  const logo = await embedLogo(doc, d.brand.logoUrl);

  doc.setTitle(san(`Client master - ${d.client.name}`));
  doc.setProducer("Aina CRM");
  doc.setAuthor(san(firm));
  doc.setSubject(`Ref ${d.refId}`);

  let page!: PDFPage; // the first startSection() makes the first page
  let y = H;
  let sectionTitle = "Client Master";

  /* ───────────── text helpers ───────────── */

  /** Wrap to `maxW`; honours line breaks; a word wider than a line is cut. */
  function wrapText(text: string, f: PDFFont, size: number, maxW: number): string[] {
    const out: string[] = [];
    for (const para of String(text ?? "").split(/\r?\n/)) {
      const words = san(para).split(" ").filter(Boolean);
      if (!words.length) { out.push(""); continue; }
      let cur = "";
      for (const w0 of words) {
        let w = w0;
        while (f.widthOfTextAtSize(w, size) > maxW && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > maxW) cut--;
          if (cur) { out.push(cur); cur = ""; }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const trial = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(trial, size) <= maxW) cur = trial;
        else { if (cur) out.push(cur); cur = w; }
      }
      if (cur) out.push(cur);
    }
    return out.length ? out : [""];
  }
  const clamp = (lines: string[], max: number, f: PDFFont, size: number, maxW: number): string[] => {
    if (lines.length <= max) return lines;
    const kept = lines.slice(0, max);
    let last = kept[max - 1];
    while (last.length > 1 && f.widthOfTextAtSize(`${last}...`, size) > maxW) last = last.slice(0, -1);
    kept[max - 1] = `${last}...`;
    return kept;
  };
  const toneColour = (t?: "good" | "warn" | "bad" | "muted"): RGB => (t === "good" ? GOOD : t === "warn" ? WARN : t === "bad" ? BAD : t === "muted" ? MUTED : INK);
  const cellText = (c: PdfCell): string => (typeof c === "string" ? c : c.t);
  const cellTone = (c: PdfCell) => (typeof c === "string" ? undefined : c.tone);

  /* ───────────── page flow ───────────── */

  function startSection(title: string, subtitle: string, note?: string) {
    page = doc.addPage([W, H]);
    sectionTitle = title;
    y = drawReportHeader({
      page, helv: font, bold, pageWidth: W, pageHeight: H, margin: M, logo, firmName: firm,
      title: title.toUpperCase(),
      subtitles: [subtitle, `Ref ${d.refId} - as on ${fmtLong(d.generatedAt)}`],
      arn: d.brand.arn, primary, secondary,
    });
    // Client line — every section names whose record it is.
    const idBits = [d.client.pan ? `PAN ${d.client.pan}` : null, d.client.rm ? `RM ${d.client.rm}` : null].filter(Boolean).join("   -   ");
    page.drawText(san(d.client.name), { x: M, y, size: 12, font: bold, color: INK });
    if (idBits) page.drawText(san(idBits), { x: M + bold.widthOfTextAtSize(san(d.client.name), 12) + 10, y, size: 8.5, font, color: MUTED });
    if (note) {
      const nw = bold.widthOfTextAtSize(note, 7.5) + 14;
      page.drawRectangle({ x: W - M - nw, y: y - 4, width: nw, height: 15, color: rgb(1, 0.97, 0.85), borderColor: rgb(0.99, 0.83, 0.3), borderWidth: 0.7 });
      page.drawText(note, { x: W - M - nw + 7, y: y, size: 7.5, font: bold, color: rgb(0.57, 0.25, 0.05) });
    }
    y -= 26;
  }
  function continuation() {
    page = doc.addPage([W, H]);
    y = drawContinuationHeader({ page, helv: font, bold, pageWidth: W, pageHeight: H, margin: M, firmName: firm, title: sectionTitle, primary });
    y -= 4;
  }
  const ensure = (need: number) => { if (y - need < BOTTOM) continuation(); };

  function group(title: string) {
    ensure(54);
    y -= 6;
    page.drawText(san(title).toUpperCase(), { x: M, y, size: 9, font: bold, color: primary });
    y -= 5;
    page.drawRectangle({ x: M, y, width: USABLE, height: 1.2, color: secondary });
    y -= 15;
  }
  function sublabel(t: string) {
    ensure(40);
    page.drawText(san(t), { x: M, y, size: 8.5, font: bold, color: SLATE });
    y -= 13;
  }
  function paragraph(text: string, size = 9, colour: RGB = SLATE) {
    for (const ln of wrapText(text, font, size, USABLE)) {
      ensure(size + 4);
      page.drawText(ln, { x: M, y, size, font, color: colour });
      y -= size + 3.5;
    }
    y -= 2;
  }

  function kvGrid(items: PdfKv[], cols = 3) {
    if (!items.length) return;
    const gap = 14;
    const colW = (USABLE - gap * (cols - 1)) / cols;
    let i = 0;
    while (i < items.length) {
      // Fill one row: items left to right, a spanning item takes several columns.
      const row: Array<{ it: PdfKv; col: number; span: number }> = [];
      let col = 0;
      while (i < items.length && col < cols) {
        const span = Math.min(items[i].span ?? 1, cols);
        if (col + span > cols) break;
        row.push({ it: items[i], col, span });
        col += span;
        i++;
      }
      if (!row.length) { row.push({ it: items[i], col: 0, span: cols }); i++; }
      const laid = row.map((r) => {
        const w = colW * r.span + gap * (r.span - 1);
        return { ...r, w, lines: clamp(wrapText(r.it.value, bold, 9, w), 3, bold, 9, w) };
      });
      const rowH = 12 + Math.max(...laid.map((l) => l.lines.length)) * 11.5 + 5;
      ensure(rowH);
      for (const l of laid) {
        const x = M + l.col * (colW + gap);
        page.drawText(san(l.it.label).toUpperCase(), { x, y, size: 6.8, font: font, color: MUTED });
        l.lines.forEach((ln, n) => page.drawText(ln, { x, y: y - 11.5 - n * 11.5, size: 9, font: bold, color: INK }));
      }
      y -= rowH;
    }
  }

  function tiles(items: Array<{ label: string; value: string; tone?: "good" | "bad" }>) {
    const gap = 8;
    const w = (USABLE - gap * (items.length - 1)) / items.length;
    ensure(50);
    items.forEach((t, n) => {
      const x = M + n * (w + gap);
      page.drawRectangle({ x, y: y - 38, width: w, height: 38, color: TILE_BG, borderColor: LINE, borderWidth: 1 });
      page.drawText(san(t.label).toUpperCase(), { x: x + 7, y: y - 13, size: 6.4, font: bold, color: MUTED });
      let size = 12;
      const v = san(t.value);
      while (size > 7.5 && bold.widthOfTextAtSize(v, size) > w - 14) size -= 0.5;
      page.drawText(v, { x: x + 7, y: y - 29, size, font: bold, color: t.tone ? toneColour(t.tone === "good" ? "good" : "bad") : primary });
    });
    y -= 38 + 14;
  }

  function table(t: PdfTable) {
    const xs: number[] = [];
    let acc = M;
    t.widths.forEach((wf) => { xs.push(acc); acc += wf * USABLE; });
    const colW = t.widths.map((wf) => wf * USABLE - 8);
    const size = 8;
    const drawHead = () => {
      ensure(30);
      page.drawRectangle({ x: M, y: y - 6, width: USABLE, height: 16, color: HEAD_BG });
      t.heads.forEach((h, c) => {
        const txt = san(h).toUpperCase();
        const tw = bold.widthOfTextAtSize(txt, 6.6);
        const right = t.align?.[c] === "r";
        page.drawText(txt, { x: right ? xs[c] + colW[c] - tw : xs[c] + 3, y: y - 1, size: 6.6, font: bold, color: SLATE });
      });
      y -= 18;
    };
    drawHead();
    if (!t.rows.length) {
      ensure(18);
      page.drawText(san(t.empty ?? "Nothing recorded."), { x: M + 3, y: y - 2, size: 8.5, font, color: MUTED });
      y -= 18;
      return;
    }
    for (const r of t.rows) {
      const laid = r.map((c, n) => clamp(wrapText(cellText(c), font, size, colW[n]), 3, font, size, colW[n]));
      const rowH = Math.max(...laid.map((l) => l.length)) * 10 + 7;
      if (y - rowH < BOTTOM) { continuation(); drawHead(); }
      laid.forEach((lines, n) => {
        const right = t.align?.[n] === "r";
        const colour = toneColour(cellTone(r[n]));
        lines.forEach((ln, k) => {
          const tw = font.widthOfTextAtSize(ln, size);
          page.drawText(ln, { x: right ? xs[n] + colW[n] - tw : xs[n] + 3, y: y - 2 - k * 10, size, font: cellTone(r[n]) ? bold : font, color: cellTone(r[n]) ? colour : INK });
        });
      });
      y -= rowH;
      page.drawRectangle({ x: M, y: y + 3, width: USABLE, height: 0.6, color: LINE });
    }
    y -= 6;
  }

  function allocation(items: Array<{ label: string; pct: number; value: number }>) {
    if (!items.length) return;
    ensure(44);
    let x = M;
    items.forEach((a, n) => {
      const w = (a.pct / 100) * USABLE;
      page.drawRectangle({ x, y: y - 10, width: Math.max(w, 0.5), height: 10, color: ALLOC_COLOURS[n % ALLOC_COLOURS.length] });
      x += w;
    });
    y -= 24;
    let lx = M;
    items.forEach((a, n) => {
      page.drawRectangle({ x: lx, y: y + 1, width: 7, height: 7, color: ALLOC_COLOURS[n % ALLOC_COLOURS.length] });
      const txt = san(`${a.label} ${a.pct.toFixed(1)}%  (${rupeeOk ? "₹" : "Rs "}${Math.round(a.value).toLocaleString("en-IN")})`);
      page.drawText(txt, { x: lx + 11, y, size: 8, font, color: SLATE });
      lx += 11 + font.widthOfTextAtSize(txt, 8) + 16;
    });
    y -= 16;
  }

  /* ───────────── 1 · CLIENT MASTER ───────────── */
  startSection("Client Master", "KYC, profile, nominees, referrals and risk profile");

  // Hero line: type · status · since · branch, and the headline figures.
  page.drawText(san(`${d.client.typeLabel}  -  ${d.client.status}${d.client.since ? `  -  Client since ${d.client.since}` : ""}${d.client.branch ? `  -  ${d.client.branch}` : ""}`), { x: M, y: y + 6, size: 8.5, font, color: MUTED });
  y -= 8;
  const money = (n: number | null) => (n == null ? "-" : `${rupeeOk ? "₹" : "Rs "}${Math.round(n).toLocaleString("en-IN")}`);
  tiles([
    { label: "Current AUM", value: money(d.client.aum) },
    { label: "SIP book (monthly)", value: money(d.client.sipBook) },
    { label: "Family", value: d.client.family ?? "Not mapped to a family" },
  ]);

  group("Identity"); kvGrid(d.master.identity);
  group("Contact"); kvGrid(d.master.contact);
  group("Profile"); kvGrid(d.master.profile);
  group("Compliance status (KYC)"); kvGrid(d.master.compliance);
  if (d.master.bank) { group("Bank accounts"); table(d.master.bank); }
  if (d.nominees) { group("Nominees"); paragraph(d.nominees.note, 8.5, MUTED); table(d.nominees.table); }
  if (d.master.secondHolder) { group("Joint / second holder"); kvGrid(d.master.secondHolder); }
  group("Lifetime and service"); kvGrid(d.master.lifetime);
  group("Referrals");
  kvGrid(d.referrals.referredBy);
  if (d.referrals.typed) { sublabel("Referrals typed on the client record"); table(d.referrals.typed); }
  sublabel("Clients and leads referred by this client"); table(d.referrals.leads);
  if (d.risk) {
    group("Risk profile");
    kvGrid(d.risk.summary);
    if (d.risk.answers) { sublabel("Questionnaire answers"); table(d.risk.answers); }
  }

  /* ───────────── 2 · PORTFOLIO ───────────── */
  if (d.portfolio) {
    startSection("Portfolio", "Mutual fund holdings and SIPs");
    tiles(d.portfolio.tiles);
    group("Holdings"); table(d.portfolio.holdings);
    if (d.portfolio.note) paragraph(d.portfolio.note, 8, MUTED);
    group("Asset allocation"); allocation(d.portfolio.allocation);
    group("Systematic investment plans"); table(d.portfolio.sips);
    paragraph(d.portfolio.sipNote, 8.5, SLATE);
  }

  /* ───────────── 3 · FIXED DEPOSITS ───────────── */
  startSection("Fixed Deposits", "Deposits placed through the firm");
  {
    const gap = 8;
    const w = (USABLE - gap * (d.fds.tiles.length - 1)) / d.fds.tiles.length;
    ensure(50);
    d.fds.tiles.forEach((t, n) => {
      const x = M + n * (w + gap);
      page.drawRectangle({ x, y: y - 38, width: w, height: 38, color: TILE_BG, borderColor: LINE, borderWidth: 1 });
      page.drawText(san(t.label).toUpperCase(), { x: x + 7, y: y - 13, size: 6.4, font: bold, color: MUTED });
      page.drawText(san(t.value), { x: x + 7, y: y - 29, size: 12, font: bold, color: primary });
    });
    y -= 52;
  }
  group("Fixed deposits"); table(d.fds.table);

  /* ───────────── 4 · CROSS-SELL ───────────── */
  startSection("Cross-sell Holdings", "Products held with the firm and what is open");
  group("Product holdings"); table(d.crossSell.holdings);
  group("Open opportunities"); table(d.crossSell.open);
  group("Won or lost in the last 12 months"); table(d.crossSell.closed);

  /* ───────────── 5 · REVIEW DETAILS ───────────── */
  startSection("Review Details", "Review schedule and recent reviews");
  group("Review schedule"); kvGrid(d.review.schedule);
  if (d.review.last) {
    group("Last review meeting");
    kvGrid(d.review.last.facts);
    if (d.review.last.points) { sublabel("Discussion points and notes"); paragraph(d.review.last.points, 8.5); }
    sublabel("Action items"); table(d.review.last.actions);
  }
  group("Review history"); table(d.review.history);

  /* ───────────── 6 · OPTIONAL SECTIONS ───────────── */
  for (const key of OPTIONAL_KEYS) {
    const sec = d.optional[key];
    if (!sec) continue;
    const label = key === "serviceRequests" ? "Service Requests" : key.charAt(0).toUpperCase() + key.slice(1);
    startSection(label, "Included at your request", "Optional section");
    group(sec.title); table(sec.table);
  }

  /* ───────────── 7 · NOTES (always last) ───────────── */
  startSection("Notes", "Notes recorded on the client");
  group(`Notes (${d.notes.length})`);
  if (!d.notes.length) paragraph("No notes recorded for this client.", 9, MUTED);
  for (const n of d.notes) {
    const lines = wrapText(n.text, font, 8.8, USABLE - 16);
    ensure(40);
    let chunkTop = y + 9;
    page.drawText(san(n.title), { x: M + 8, y, size: 9, font: bold, color: INK });
    const at = san(`${n.at}${n.by ? `  -  ${n.by}` : ""}`);
    page.drawText(at, { x: W - M - font.widthOfTextAtSize(at, 7.8), y, size: 7.8, font, color: MUTED });
    y -= 13;
    for (const ln of lines) {
      if (y - 11 < BOTTOM) {
        page.drawRectangle({ x: M, y: y + 6, width: 2.4, height: chunkTop - (y + 6), color: secondary });
        continuation();
        chunkTop = y + 9;
      }
      page.drawText(ln, { x: M + 8, y, size: 8.8, font, color: SLATE });
      y -= 11.5;
    }
    page.drawRectangle({ x: M, y: y + 6, width: 2.4, height: chunkTop - (y + 6), color: secondary });
    y -= 10;
  }
  paragraph(`End of Client Master - ${firm}`, 7.5, MUTED);

  /* ───────────── per-page furniture ───────────── */
  const pages = doc.getPages();
  pages.forEach((p) => {
    p.drawRectangle({ x: M, y: 52, width: USABLE, height: 1, color: LINE });
    const left = san(`${firm}  -  ARN-${(d.brand.arn ?? "-").toString().replace(/^ARN-?/i, "")}`);
    p.drawText(left, { x: M, y: 40, size: 8, font: bold, color: SLATE });
    const right = san(`Generated ${fmtLong(d.generatedAt)}, Ref ${d.refId}`);
    p.drawText(right, { x: W - M - font.widthOfTextAtSize(right, 7.5), y: 40, size: 7.5, font, color: MUTED });
    p.drawText("Confidential - prepared for internal use. Contains personal data; handle under the firm's privacy notice.", { x: M, y: 28, size: 7, font, color: MUTED });
  });
  drawPageNumbers(doc, font, W, 14);

  return Buffer.from(await doc.save());
}

function fmtLong(iso: string): string {
  const x = new Date(iso);
  if (isNaN(x.getTime())) return "-";
  return x.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
