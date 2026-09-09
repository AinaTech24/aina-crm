/**
 * Client Satisfaction & NPS report (PDF).
 *
 * The same branded shell as the Risk Assessment Report — masthead, footer,
 * headline figures, then the detail — so a firm's documents look like a set.
 *
 * Shows how the Net Promoter Score is arrived at rather than just printing it:
 * the promoter / passive / detractor split is what a reader needs to judge the
 * number, and a score built on three responses means something different from
 * one built on three hundred.
 *
 * Helvetica is WinAnsi-only, so all dynamic text passes through ascii().
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";

export type FeedbackRow = {
  clientName: string | null;
  rating: number | null;
  comment: string | null;
  submittedAt: string | Date | null;
};

export type FeedbackBrand = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  website?: string | null;
  primaryColor?: string | null;
};

export type RenderFeedbackArgs = {
  rows: FeedbackRow[];
  brand: FeedbackBrand;
  generatedAt: string;
  /** Optional period label, e.g. "01 Apr 2026 - 31 Mar 2027". */
  periodLabel?: string | null;
};

const INK: RGB = rgb(0.09, 0.13, 0.19);
const SLATE: RGB = rgb(0.29, 0.35, 0.42);
const MUTED: RGB = rgb(0.55, 0.61, 0.68);
const LINE: RGB = rgb(0.87, 0.89, 0.92);
const WHITE: RGB = rgb(1, 1, 1);
const PAPER: RGB = rgb(0.976, 0.98, 0.985);
const GREEN: RGB = rgb(0.02, 0.6, 0.41);
const AMBER: RGB = rgb(0.85, 0.55, 0.02);
const RED: RGB = rgb(0.86, 0.15, 0.15);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);

const W = 595.28;
const H = 841.89; // A4
const MARGIN = 46;
const CONTENT_W = W - 2 * MARGIN;
const HEADER_H = 74;
const FOOTER_H = 26;
const BODY_FLOOR = FOOTER_H + 22;

let KEEP_RUPEE = false;

/** 0-6 detractor, 7-8 passive, 9-10 promoter — the standard NPS bands. */
function band(score: number): "promoter" | "passive" | "detractor" {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}
function bandTone(score: number): RGB {
  const b = band(score);
  return b === "promoter" ? GREEN : b === "passive" ? AMBER : RED;
}

export async function renderFeedbackPdf(args: RenderFeedbackArgs): Promise<Buffer> {
  const { brand } = args;
  const doc = await PDFDocument.create();
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  KEEP_RUPEE = rupeeOk;

  const primary = hexToRgb(brand.primaryColor);
  const firmName = brand.legalName ?? brand.displayName ?? "Your Advisor";

  doc.setTitle(ascii(`Client Satisfaction & NPS - ${firmName}`));
  doc.setProducer("Aina CRM");
  doc.setAuthor(ascii(firmName));

  // Newest first, and only rows that actually carry a score.
  const rows = (args.rows ?? [])
    .filter((r) => r.rating != null && Number.isFinite(Number(r.rating)))
    .sort((a, b) => new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime());

  const total = rows.length;
  const promoters = rows.filter((r) => band(Number(r.rating)) === "promoter").length;
  const passives = rows.filter((r) => band(Number(r.rating)) === "passive").length;
  const detractors = rows.filter((r) => band(Number(r.rating)) === "detractor").length;
  const nps = total ? Math.round(((promoters - detractors) / total) * 100) : 0;
  const avg = total ? rows.reduce((s, r) => s + Number(r.rating), 0) / total : 0;

  const ctx = { helv, bold, primary, firmName, brand, generatedAt: args.generatedAt };

  let page = doc.addPage([W, H]);
  let y = drawMasthead(page, ctx);

  const newPage = () => {
    drawFooterBar(page, ctx);
    page = doc.addPage([W, H]);
    drawSlimHeader(page, ctx);
    y = H - 44;
  };
  const ensure = (need: number) => {
    if (y - need < BODY_FLOOR) newPage();
  };

  // ── Title ────────────────────────────────────────────────────────────────
  const titleH = 50;
  page.drawRectangle({ x: 0, y: y - titleH, width: W, height: titleH, color: blend(primary, 0.07) });
  centerText(page, "Client Satisfaction & NPS", y - 21, 15, bold, INK);
  centerText(
    page,
    ascii(args.periodLabel?.trim() ? `Period: ${args.periodLabel}` : `As at ${fmtDateLong(args.generatedAt)}`),
    y - 38,
    9.5,
    helv,
    SLATE
  );
  y -= titleH + 24;

  // ── Headline figures ─────────────────────────────────────────────────────
  const stats: Array<[string, string, RGB]> = [
    ["NET PROMOTER SCORE", total ? `${nps > 0 ? "+" : ""}${nps}` : "-", nps >= 0 ? GREEN : RED],
    ["RESPONSES", String(total), INK],
    ["AVERAGE RATING", total ? `${avg.toFixed(1)} / 10` : "-", INK],
  ];
  const sw = (CONTENT_W - 2 * 10) / 3;
  const sh = 54;
  stats.forEach(([label, value, tone], i) => {
    const x = MARGIN + i * (sw + 10);
    page.drawRectangle({ x, y: y - sh, width: sw, height: sh, color: WHITE, borderColor: LINE, borderWidth: 0.8 });
    const lw = helv.widthOfTextAtSize(label, 7);
    page.drawText(label, { x: x + (sw - lw) / 2, y: y - 19, size: 7, font: helv, color: MUTED });
    const v = ascii(value);
    const vs = fitSize(v, bold, sw - 14, 20, 12);
    const vw = bold.widthOfTextAtSize(v, vs);
    page.drawText(v, { x: x + (sw - vw) / 2, y: y - 42, size: vs, font: bold, color: tone });
  });
  y -= sh + 26;

  // ── How the score breaks down ────────────────────────────────────────────
  y = sectionRule(page, ctx, y, "HOW THE SCORE BREAKS DOWN");
  y -= 18;

  const split: Array<[string, number, RGB]> = [
    ["Promoters (9-10)", promoters, GREEN],
    ["Passives (7-8)", passives, AMBER],
    ["Detractors (0-6)", detractors, RED],
  ];
  for (const [label, count, tone] of split) {
    ensure(26);
    const pct = total ? Math.round((count / total) * 100) : 0;
    page.drawText(ascii(label), { x: MARGIN, y, size: 9.5, font: bold, color: tone });

    // Proportion bar — the split is the point, so show it, not just the counts.
    const barX = MARGIN + 130;
    const barW = CONTENT_W - 130 - 74;
    page.drawRectangle({ x: barX, y: y - 3, width: barW, height: 9, color: PAPER, borderColor: LINE, borderWidth: 0.6 });
    if (total && count) {
      page.drawRectangle({ x: barX, y: y - 3, width: Math.max(2, (barW * count) / total), height: 9, color: tone });
    }
    const tail = ascii(`${count}  (${pct}%)`);
    const tw = helv.widthOfTextAtSize(tail, 9);
    page.drawText(tail, { x: MARGIN + CONTENT_W - tw, y, size: 9, font: helv, color: SLATE });
    y -= 24;
  }

  y -= 6;
  const note =
    "NPS is the share of promoters minus the share of detractors, so it runs from -100 to +100. Passives count " +
    "towards the total but not the score. A score drawn from a small number of responses moves sharply with each new one.";
  for (const ln of wrap(ascii(note), helv, 8, CONTENT_W)) {
    ensure(12);
    page.drawText(ln, { x: MARGIN, y, size: 8, font: helv, color: MUTED });
    y -= 10;
  }
  y -= 18;

  // ── Every response ───────────────────────────────────────────────────────
  ensure(60);
  y = sectionRule(page, ctx, y, `RESPONSES (${total})`);
  y -= 18;

  if (!total) {
    page.drawText("No feedback has been received yet.", { x: MARGIN, y, size: 9.5, font: helv, color: MUTED });
    y -= 16;
  } else {
    const colRating = MARGIN + CONTENT_W - 150;
    const colDate = MARGIN + CONTENT_W - 88;

    const header = () => {
      page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 20, color: blend(primary, 0.07) });
      page.drawText("CLIENT", { x: MARGIN + 10, y, size: 7.5, font: bold, color: INK });
      page.drawText("RATING", { x: colRating, y, size: 7.5, font: bold, color: INK });
      page.drawText("SUBMITTED", { x: colDate, y, size: 7.5, font: bold, color: INK });
      y -= 24;
    };
    header();

    for (const r of rows) {
      const score = Number(r.rating);
      const nameLines = wrap(ascii(r.clientName ?? "Client"), bold, 9.5, colRating - MARGIN - 20);
      // Wrap the comment inside the CLIENT column only — at full content width
      // a long one ran underneath the rating and date and overlapped them.
      const commentLines = r.comment?.trim()
        ? wrap(ascii(`"${r.comment.trim()}"`), helv, 8.5, colRating - MARGIN - 24)
        : [];
      const rowH = nameLines.length * 12 + commentLines.length * 11 + 12;

      if (y - rowH < BODY_FLOOR) {
        newPage();
        header();
      }

      nameLines.forEach((ln, i) => {
        page.drawText(ln, { x: MARGIN + 10, y: y - i * 12, size: 9.5, font: bold, color: INK });
      });

      const st = `${score}/10`;
      page.drawText(st, { x: colRating, y, size: 9.5, font: bold, color: bandTone(score) });
      const bandLabel = band(score) === "promoter" ? "Promoter" : band(score) === "passive" ? "Passive" : "Detractor";
      page.drawText(bandLabel, { x: colRating, y: y - 11, size: 7, font: helv, color: MUTED });

      page.drawText(ascii(fmtDate(r.submittedAt)), { x: colDate, y, size: 8.5, font: helv, color: SLATE });

      let cy = y - nameLines.length * 12;
      for (const ln of commentLines) {
        page.drawText(ln, { x: MARGIN + 10, y: cy, size: 8.5, font: helv, color: SLATE });
        cy -= 11;
      }

      y -= rowH;
      page.drawRectangle({ x: MARGIN, y: y + 6, width: CONTENT_W, height: 0.6, color: LINE });
    }
  }

  drawFooterBar(page, ctx);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/* ───────────────────────── page furniture ───────────────────────── */

type Ctx = {
  helv: PDFFont;
  bold: PDFFont;
  primary: RGB;
  firmName: string;
  brand: FeedbackBrand;
  generatedAt: string;
};

function drawMasthead(page: PDFPage, ctx: Ctx): number {
  const { helv, bold, primary } = ctx;
  page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: primary });
  const nameSize = fitSize(ascii(ctx.firmName), bold, CONTENT_W - 150, 19, 13);
  page.drawText(ascii(ctx.firmName), { x: MARGIN, y: H - 36, size: nameSize, font: bold, color: WHITE });
  const tagline = ctx.brand.arn ? "AMFI Registered Mutual Fund Distributor" : "Mutual Fund Distributor";
  page.drawText(ascii(tagline), { x: MARGIN, y: H - 54, size: 10, font: bold, color: blend(WHITE, 0.85) });

  const right = [
    ctx.brand.arn ? `ARN-${String(ctx.brand.arn).replace(/^ARN[-\s]*/i, "")}` : "",
    fmtDateLong(ctx.generatedAt),
  ].filter(Boolean);
  right.forEach((t, i) => {
    const s = ascii(t);
    const tw = helv.widthOfTextAtSize(s, 9.5);
    page.drawText(s, { x: W - MARGIN - tw, y: H - 32 - i * 15, size: 9.5, font: helv, color: blend(WHITE, 0.9) });
  });
  return H - HEADER_H;
}

function drawSlimHeader(page: PDFPage, ctx: Ctx) {
  const { bold, primary } = ctx;
  const h = 30;
  page.drawRectangle({ x: 0, y: H - h, width: W, height: h, color: primary });
  const name = ascii(ctx.firmName);
  page.drawText(name, { x: MARGIN, y: H - 20, size: fitSize(name, bold, CONTENT_W - 140, 11, 8), font: bold, color: WHITE });
}

function drawFooterBar(page: PDFPage, ctx: Ctx) {
  const { helv, primary } = ctx;
  page.drawRectangle({ x: 0, y: 0, width: W, height: FOOTER_H, color: primary });
  const site = (ctx.brand.website ?? "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const text = ascii(`This is a system generated document from ${ctx.firmName}${site ? `  |  ${site}` : ""}`);
  const size = fitSize(text, helv, CONTENT_W, 7.5, 6);
  const tw = helv.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (W - tw) / 2, y: 9.5, size, font: helv, color: blend(WHITE, 0.92) });
}

function sectionRule(page: PDFPage, ctx: Ctx, y: number, title: string): number {
  const { bold, primary } = ctx;
  const t = ascii(title);
  const size = 9;
  const tw = bold.widthOfTextAtSize(t, size);
  page.drawText(t, { x: MARGIN, y, size, font: bold, color: INK });
  const lineX = MARGIN + tw + 12;
  const lineW = CONTENT_W - tw - 12;
  if (lineW > 8) page.drawRectangle({ x: lineX, y: y + 3, width: lineW, height: 0.8, color: blend(primary, 0.35) });
  return y - 8;
}

/* ───────────────────────── primitives ───────────────────────── */

function centerText(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: RGB) {
  const t = ascii(text);
  page.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
}

function blend(c: RGB, a: number): RGB {
  return rgb(1 - (1 - c.red) * a, 1 - (1 - c.green) * a, 1 - (1 - c.blue) * a);
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "-";
  const dd = d instanceof Date ? d : new Date(String(d));
  return isNaN(dd.getTime())
    ? "-"
    : dd.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateLong(d: string | Date | null | undefined): string {
  if (!d) return "-";
  const dd = d instanceof Date ? d : new Date(String(d));
  return isNaN(dd.getTime()) ? "-" : dd.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function fitSize(text: string, font: PDFFont, maxW: number, start: number, min: number): number {
  let s = start;
  while (s > min && font.widthOfTextAtSize(text, s) > maxW) s -= 0.5;
  return s;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth || !cur) cur = trial;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function ascii(s: string): string {
  if (!s) return "";
  return pdfSanitize(String(s).replace(/·/g, "-"), KEEP_RUPEE);
}

function hexToRgb(hex: string | null | undefined): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return DEFAULT_PRIMARY;
  const [r, g, b] = (m[1].match(/.{2}/g) as string[]).map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
