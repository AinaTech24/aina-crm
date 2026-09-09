/**
 * Client Feedback Report (PDF) — one client.
 *
 * The firm-wide report answers "how are we doing"; this one answers "how does
 * THIS client feel", which is the version an RM takes into a review meeting.
 *
 * Each submission is shown in full — every question with its score — rather
 * than only an average, because which question scored low is the entire point.
 * Where a client has answered more than once, the change per question is shown
 * against their previous response, since a 7 that used to be a 9 matters more
 * than a 7 on its own.
 *
 * Same branded shell as the Risk Assessment Report, so a firm's documents look
 * like a set. Helvetica is WinAnsi-only, so text passes through ascii().
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import { bandLabel, scoreBand, type FeedbackAnswer } from "@/lib/support/feedback-questions";

export type ClientFeedbackSubmission = {
  submittedAt: string | Date | null;
  /** The recommend (NPS) score. */
  rating: number | null;
  comment: string | null;
  answers: FeedbackAnswer[] | null;
  ticketNo?: string | null;
};

export type ClientFeedbackBrand = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  website?: string | null;
  primaryColor?: string | null;
};

export type RenderClientFeedbackArgs = {
  client: { name: string | null; pan?: string | null; rmName?: string | null };
  submissions: ClientFeedbackSubmission[];
  brand: ClientFeedbackBrand;
  generatedAt: string;
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
const H = 841.89;
const MARGIN = 46;
const CONTENT_W = W - 2 * MARGIN;
const HEADER_H = 74;
const FOOTER_H = 26;
const BODY_FLOOR = FOOTER_H + 22;

let KEEP_RUPEE = false;

function toneFor(score: number): RGB {
  const b = scoreBand(score);
  return b === "promoter" ? GREEN : b === "passive" ? AMBER : RED;
}

export async function renderClientFeedbackPdf(args: RenderClientFeedbackArgs): Promise<Buffer> {
  const { brand, client } = args;
  const doc = await PDFDocument.create();
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  KEEP_RUPEE = rupeeOk;

  const primary = hexToRgb(brand.primaryColor);
  const firmName = brand.legalName ?? brand.displayName ?? "Your Advisor";
  const clientName = client.name ?? "Client";

  doc.setTitle(ascii(`Client Feedback - ${clientName}`));
  doc.setProducer("Aina CRM");
  doc.setAuthor(ascii(firmName));

  // Newest first.
  const subs = (args.submissions ?? [])
    .slice()
    .sort((a, b) => new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime());

  const ctx: Ctx = { helv, bold, primary, firmName, brand, generatedAt: args.generatedAt };

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
  const titleH = 52;
  page.drawRectangle({ x: 0, y: y - titleH, width: W, height: titleH, color: blend(primary, 0.07) });
  centerText(page, "Client Feedback Report", y - 21, 15, bold, INK);
  centerText(page, ascii(clientName), y - 39, 12.5, bold, INK);
  y -= titleH + 20;

  // ── Meta strip ───────────────────────────────────────────────────────────
  const metaH = 30;
  page.drawRectangle({
    x: MARGIN,
    y: y - metaH,
    width: CONTENT_W,
    height: metaH,
    color: PAPER,
    borderColor: LINE,
    borderWidth: 0.8,
  });
  const cells: Array<[string, string]> = [
    ["Responses", String(subs.length)],
    ["Relationship manager", client.rmName?.trim() || "-"],
    ["Report date", fmtDateLong(args.generatedAt)],
  ];
  cells.forEach(([k, v], i) => {
    const x = MARGIN + 14 + i * (CONTENT_W / 3);
    page.drawText(ascii(`${k}: ${v}`), { x, y: y - 19, size: 8.5, font: helv, color: SLATE });
  });
  y -= metaH + 24;

  if (!subs.length) {
    y = sectionRule(page, ctx, y, "FEEDBACK");
    y -= 18;
    for (const ln of wrap(
      ascii(
        `${clientName} has not submitted any feedback yet. Send them a feedback link from their client page to collect it.`
      ),
      helv,
      9.5,
      CONTENT_W
    )) {
      page.drawText(ln, { x: MARGIN, y, size: 9.5, font: helv, color: MUTED });
      y -= 13;
    }
    drawFooterBar(page, ctx);
    return Buffer.from(await doc.save());
  }

  // ── Latest at a glance ───────────────────────────────────────────────────
  const latest = subs[0];
  const latestAnswers = (latest.answers ?? []).filter((a) => Number.isFinite(Number(a.score)));
  const latestAvg = latestAnswers.length
    ? latestAnswers.reduce((s, a) => s + Number(a.score), 0) / latestAnswers.length
    : null;

  const stats: Array<[string, string, RGB]> = [
    [
      "LATEST OVERALL",
      latestAvg != null ? `${latestAvg.toFixed(1)} / 10` : latest.rating != null ? `${latest.rating} / 10` : "-",
      latestAvg != null ? toneFor(latestAvg) : INK,
    ],
    [
      "WOULD RECOMMEND",
      latest.rating != null ? `${latest.rating} / 10` : "-",
      latest.rating != null ? toneFor(Number(latest.rating)) : INK,
    ],
    ["STATUS", latest.rating != null ? bandLabel(Number(latest.rating)) : "-", latest.rating != null ? toneFor(Number(latest.rating)) : INK],
    ["LAST SUBMITTED", fmtDate(latest.submittedAt), INK],
  ];
  const bw = (CONTENT_W - 3 * 8) / 4;
  const bh = 46;
  stats.forEach(([label, value, tone], i) => {
    const x = MARGIN + i * (bw + 8);
    page.drawRectangle({ x, y: y - bh, width: bw, height: bh, color: WHITE, borderColor: LINE, borderWidth: 0.8 });
    const lw = helv.widthOfTextAtSize(label, 6.5);
    page.drawText(label, { x: x + (bw - lw) / 2, y: y - 17, size: 6.5, font: helv, color: MUTED });
    const v = ascii(value);
    const vs = fitSize(v, bold, bw - 12, 12, 7.5);
    const vw = bold.widthOfTextAtSize(v, vs);
    page.drawText(v, { x: x + (bw - vw) / 2, y: y - 33, size: vs, font: bold, color: tone });
  });
  y -= bh + 26;

  // ── Each submission, in full ─────────────────────────────────────────────
  subs.forEach((sub, si) => {
    const answers = (sub.answers ?? []).filter((a) => Number.isFinite(Number(a.score)));
    const previous = subs[si + 1];
    const prevByKey = new Map(
      (previous?.answers ?? []).map((a) => [a.key, Number(a.score)] as const)
    );

    ensure(46);
    const heading = si === 0 ? "LATEST RESPONSE" : `EARLIER RESPONSE — ${fmtDate(sub.submittedAt)}`;
    y = sectionRule(page, ctx, y, heading);
    y -= 16;

    if (si === 0) {
      page.drawText(ascii(`Submitted ${fmtDateLong(sub.submittedAt)}`), {
        x: MARGIN,
        y,
        size: 8.5,
        font: helv,
        color: MUTED,
      });
      y -= 16;
    }

    if (!answers.length) {
      // Feedback captured before the questionnaire existed carries one score.
      const only = sub.rating;
      page.drawText(ascii(only != null ? `Would recommend: ${only} / 10` : "No scores recorded."), {
        x: MARGIN,
        y,
        size: 9.5,
        font: bold,
        color: only != null ? toneFor(Number(only)) : MUTED,
      });
      y -= 18;
    } else {
      for (const a of answers) {
        const score = Number(a.score);
        const qLines = wrap(ascii(a.label || a.key), helv, 9, CONTENT_W - 150);
        ensure(qLines.length * 12 + 12);

        qLines.forEach((ln, i) => {
          page.drawText(ln, { x: MARGIN, y: y - i * 12, size: 9, font: helv, color: INK });
        });

        // Score bar — 10 segments, filled to the score.
        const barX = MARGIN + CONTENT_W - 140;
        const barW = 78;
        page.drawRectangle({ x: barX, y: y - 3, width: barW, height: 8, color: PAPER, borderColor: LINE, borderWidth: 0.6 });
        page.drawRectangle({
          x: barX,
          y: y - 3,
          width: Math.max(1.5, (barW * score) / 10),
          height: 8,
          color: toneFor(score),
        });

        const st = `${score}/10`;
        page.drawText(st, { x: barX + barW + 8, y: y - 2, size: 9, font: bold, color: toneFor(score) });

        // Movement against the previous submission.
        const prev = prevByKey.get(a.key);
        if (prev != null && Number.isFinite(prev)) {
          const delta = score - prev;
          if (delta !== 0) {
            const dt = `${delta > 0 ? "+" : ""}${delta}`;
            const dw = helv.widthOfTextAtSize(dt, 8);
            page.drawText(dt, {
              x: MARGIN + CONTENT_W - dw,
              y: y - 2,
              size: 8,
              font: helv,
              color: delta > 0 ? GREEN : RED,
            });
          }
        }

        y -= qLines.length * 12 + 6;
      }
    }

    if (sub.comment?.trim()) {
      const cLines = wrap(ascii(`"${sub.comment.trim()}"`), helv, 9, CONTENT_W - 24);
      ensure(cLines.length * 12 + 18);
      const boxH = cLines.length * 12 + 14;
      page.drawRectangle({
        x: MARGIN,
        y: y - boxH + 6,
        width: CONTENT_W,
        height: boxH,
        color: PAPER,
        borderColor: LINE,
        borderWidth: 0.8,
      });
      let cy = y - 4;
      for (const ln of cLines) {
        page.drawText(ln, { x: MARGIN + 12, y: cy, size: 9, font: helv, color: SLATE });
        cy -= 12;
      }
      y -= boxH + 6;
    }

    y -= 14;
  });

  drawFooterBar(page, ctx);
  return Buffer.from(await doc.save());
}

/* ───────────────────────── page furniture ───────────────────────── */

type Ctx = {
  helv: PDFFont;
  bold: PDFFont;
  primary: RGB;
  firmName: string;
  brand: ClientFeedbackBrand;
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
  const tw = bold.widthOfTextAtSize(t, 9);
  page.drawText(t, { x: MARGIN, y, size: 9, font: bold, color: INK });
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
  return isNaN(dd.getTime()) ? "-" : dd.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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
