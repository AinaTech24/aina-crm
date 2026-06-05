/**
 * Server-rendered Risk Profiling statement (PDF).
 *
 * Renders the client's completed risk questionnaire — every question, the
 * answer they chose, the per-question score — plus the computed risk category
 * and the signature/audit footer. Pure pdf-lib (no native deps), branded with
 * the firm's letterhead, matching the portfolio-statement PDF.
 *
 * Helvetica is WinAnsi-only, so all dynamic text passes through ascii()
 * (₹ → "Rs ", smart-quotes/dashes normalised) before drawing.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
import type { StatementBrand } from "@/lib/finance/valuation-pdf";

export type RiskProfilePdfData = {
  /** Canonical category: conservative | moderate | aggressive | very_aggressive. */
  category: string | null;
  totalScore: number | null;
  profileDate?: string | null; // yyyy-mm-dd
  signedAt?: string | null; // ISO
  signedByName?: string | null;
  nextReviewAt?: string | null; // yyyy-mm-dd
  age?: number | null;
  verificationMethod?: string | null;
  /** Per-question breakdown, as stored in risk_profile_responses.responses. */
  responses: Array<{ key?: string; question?: string; answer?: string; score?: number | null }>;
};

export type RiskProfileInvestor = { name: string | null; pan?: string | null };

export type RenderRiskProfileArgs = {
  profile: RiskProfilePdfData;
  investor: RiskProfileInvestor;
  brand: StatementBrand;
  /** ISO date the PDF was generated (injected for determinism). */
  generatedAt: string;
};

const ACCENT: RGB = rgb(0.055, 0.647, 0.914);
const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.58, 0.64, 0.72);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);
const LINE: RGB = rgb(0.89, 0.91, 0.94);

const W = 595.28;
const H = 841.89; // A4
const MARGIN = 44;
const FOOTER_TOP = 56; // body content must stay above this

const CATEGORY_META: Record<string, { label: string; blurb: string; tone: RGB }> = {
  conservative: {
    label: "Conservative",
    blurb: "Prioritises capital protection and stability over high returns.",
    tone: rgb(0.15, 0.39, 0.92),
  },
  moderate: {
    label: "Moderate",
    blurb: "Balances growth and stability; accepts measured volatility for better long-term returns.",
    tone: rgb(0.02, 0.6, 0.41),
  },
  aggressive: {
    label: "Aggressive",
    blurb: "Seeks high long-term growth and can tolerate significant short-term volatility.",
    tone: rgb(0.85, 0.47, 0.02),
  },
  very_aggressive: {
    label: "Very aggressive",
    blurb: "Maximises growth potential and is comfortable with large swings in value.",
    tone: rgb(0.86, 0.15, 0.15),
  },
};

const DISCLAIMER =
  "This risk profile is based on the client's self-declared responses and is used to recommend suitable " +
  "investments. Mutual Fund investments are subject to market risks; read all scheme related documents carefully.";

export async function renderRiskProfilePdf(args: RenderRiskProfileArgs): Promise<Buffer> {
  const { profile, investor, brand } = args;
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const primary = hexToRgb(brand.primaryColor);
  const logo = await embedLogo(doc, brand.logoUrl);

  doc.setTitle(ascii(`Risk profile — ${investor.name ?? "Client"}`));
  doc.setProducer("Aina CRM");
  if (brand.legalName || brand.displayName) doc.setAuthor(ascii(brand.legalName ?? brand.displayName ?? ""));

  const ctx = { helv, bold, primary, logo, brand, generatedAt: args.generatedAt };
  const contentW = W - 2 * MARGIN;

  let page = doc.addPage([W, H]);
  let y = drawHeader(page, ctx, true);

  // ── Client line ───────────────────────────────────────────────────────
  page.drawText(ascii(investor.name ?? "Client"), { x: MARGIN, y, size: 15, font: bold, color: INK });
  const idBits = [
    investor.pan ? `PAN ${investor.pan}` : null,
    profile.age != null ? `Age ${profile.age}` : null,
  ].filter(Boolean).join("   ·   ");
  if (idBits) page.drawText(ascii(idBits), { x: MARGIN, y: y - 16, size: 9.5, font: helv, color: SLATE });
  y -= 42;

  // ── Result card ───────────────────────────────────────────────────────
  const meta = CATEGORY_META[(profile.category ?? "").toLowerCase()] ?? {
    label: profile.category ? titleCase(profile.category) : "—",
    blurb: "",
    tone: primary,
  };
  const cardH = 96;
  page.drawRectangle({
    x: MARGIN, y: y - cardH, width: contentW, height: cardH,
    color: rgb(0.97, 0.98, 0.99), borderColor: LINE, borderWidth: 1,
  });
  // accent left bar
  page.drawRectangle({ x: MARGIN, y: y - cardH, width: 5, height: cardH, color: meta.tone });
  page.drawText("RISK CATEGORY", { x: MARGIN + 16, y: y - 20, size: 7, font: bold, color: MUTED });
  page.drawText(ascii(meta.label), { x: MARGIN + 16, y: y - 44, size: 22, font: bold, color: meta.tone });
  if (profile.totalScore != null) {
    const st = `Score ${profile.totalScore}`;
    const sw = bold.widthOfTextAtSize(st, 11);
    page.drawText(st, { x: W - MARGIN - 16 - sw, y: y - 20, size: 11, font: bold, color: INK });
  }
  if (meta.blurb) {
    let by = y - 60;
    for (const ln of wrap(ascii(meta.blurb), helv, 8.5, contentW - 32).slice(0, 2)) {
      page.drawText(ln, { x: MARGIN + 16, y: by, size: 8.5, font: helv, color: SLATE });
      by -= 11;
    }
  }
  // meta line at the bottom of the card
  const metaBits = [
    profile.profileDate ? `Profiled on ${fmtDate(profile.profileDate)}` : null,
    profile.signedByName ? `Signed by ${profile.signedByName}` : null,
    profile.nextReviewAt ? `Next review ${fmtDate(profile.nextReviewAt)}` : null,
  ].filter(Boolean).join("   ·   ");
  if (metaBits) page.drawText(ascii(metaBits), { x: MARGIN + 16, y: y - cardH + 12, size: 8, font: helv, color: MUTED });
  y -= cardH + 26;

  // ── Questionnaire responses ───────────────────────────────────────────
  const ensure = (need: number) => {
    if (y - need < FOOTER_TOP + 10) {
      drawFooter(page, ctx);
      page = doc.addPage([W, H]);
      y = drawHeader(page, ctx, false);
    }
  };

  ensure(24);
  page.drawText("QUESTIONNAIRE RESPONSES", { x: MARGIN, y, size: 9, font: bold, color: primary });
  y -= 6;
  page.drawRectangle({ x: MARGIN, y: y - 2, width: contentW, height: 1, color: LINE });
  y -= 18;

  const items = Array.isArray(profile.responses) ? profile.responses : [];
  if (items.length === 0) {
    page.drawText("No questionnaire responses recorded.", { x: MARGIN, y, size: 9, font: helv, color: MUTED });
    y -= 16;
  }

  let idx = 1;
  for (const r of items) {
    const qLines = wrap(ascii(`${idx}. ${r.question ?? "—"}`), bold, 9.5, contentW - 46);
    const aLines = wrap(ascii(r.answer ?? "—"), helv, 9.5, contentW - 60);
    const blockH = qLines.length * 13 + aLines.length * 12 + 14;
    ensure(blockH);

    for (const ln of qLines) {
      page.drawText(ln, { x: MARGIN, y, size: 9.5, font: bold, color: INK });
      y -= 13;
    }
    for (let i = 0; i < aLines.length; i++) {
      page.drawText(aLines[i], { x: MARGIN + 14, y, size: 9.5, font: helv, color: SLATE });
      if (i === 0 && r.score != null) {
        const st = `+${r.score}`;
        const sw = bold.widthOfTextAtSize(st, 9);
        page.drawText(st, { x: W - MARGIN - sw, y, size: 9, font: bold, color: primary });
      }
      y -= 12;
    }
    y -= 5;
    page.drawRectangle({ x: MARGIN, y, width: contentW, height: 0.6, color: LINE });
    y -= 13;
    idx++;
  }

  drawFooter(page, ctx);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/* ───────────────────────── layout helpers ───────────────────────── */

type Ctx = {
  helv: PDFFont;
  bold: PDFFont;
  primary: RGB;
  logo: PDFImage | null;
  brand: StatementBrand;
  generatedAt: string;
};

/** Letterhead. `full` = page 1 (logo + ARN + gradient strip); else a slim
 *  continuation header. Returns the y to start body content at. */
function drawHeader(page: PDFPage, ctx: Ctx, full: boolean): number {
  const { helv, bold, primary, logo, brand } = ctx;
  const topY = H - MARGIN;

  if (!full) {
    page.drawText(ascii(brand.legalName ?? brand.displayName ?? "Risk profile"), {
      x: MARGIN, y: topY - 10, size: 9, font: bold, color: SLATE,
    });
    const cont = "Risk profile (continued)";
    const cw = helv.widthOfTextAtSize(cont, 8);
    page.drawText(cont, { x: W - MARGIN - cw, y: topY - 10, size: 8, font: helv, color: MUTED });
    page.drawRectangle({ x: MARGIN, y: topY - 18, width: W - 2 * MARGIN, height: 1, color: LINE });
    return topY - 36;
  }

  let nameX = MARGIN;
  if (logo) {
    const maxH = 38, maxW = 150;
    let dw = (logo.width / logo.height) * maxH;
    let dh = maxH;
    if (dw > maxW) { dw = maxW; dh = (logo.height / logo.width) * maxW; }
    page.drawImage(logo, { x: MARGIN, y: topY - dh, width: dw, height: dh });
    nameX = MARGIN + dw + 12;
  }
  page.drawText(ascii(brand.legalName ?? brand.displayName ?? "Your Advisor"), {
    x: nameX, y: topY - 15, size: 14, font: bold, color: INK,
  });
  page.drawText(
    ascii(
      `ARN ${(brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}` +
      `${brand.euin ? ` - EUIN ${brand.euin}` : ""}` +
      `${brand.gstNumber ? ` - GSTIN ${brand.gstNumber}` : ""}`
    ),
    { x: nameX, y: topY - 30, size: 9, font: helv, color: SLATE }
  );
  const titleLabel = "RISK PROFILE";
  const tlW = bold.widthOfTextAtSize(titleLabel, 11);
  page.drawText(titleLabel, { x: W - MARGIN - tlW, y: topY - 13, size: 11, font: bold, color: primary });
  const asOf = ascii(`As of ${fmtDate(ctx.generatedAt)}`);
  const aoW = helv.widthOfTextAtSize(asOf, 9);
  page.drawText(asOf, { x: W - MARGIN - aoW, y: topY - 28, size: 9, font: helv, color: SLATE });

  const stripY = topY - 46;
  drawGradientStrip(page, MARGIN, stripY, W - 2 * MARGIN, 5, primary, ACCENT);
  return stripY - 26;
}

function drawFooter(page: PDFPage, ctx: Ctx) {
  const { helv, bold, brand } = ctx;
  page.drawRectangle({ x: MARGIN, y: 52, width: W - 2 * MARGIN, height: 1, color: LINE });
  const legal = ascii(brand.legalName ?? brand.displayName ?? "Your Advisor");
  const arn = ascii(`ARN-${(brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}`);
  page.drawText(`${legal}  -  ${arn}`, { x: MARGIN, y: 40, size: 8, font: bold, color: SLATE });
  const gen = ascii(`Generated ${fmtDateTime(ctx.generatedAt)}`);
  const gw = helv.widthOfTextAtSize(gen, 7.5);
  page.drawText(gen, { x: W - MARGIN - gw, y: 40, size: 7.5, font: helv, color: MUTED });
  let dy = 26;
  for (const line of wrap(DISCLAIMER, helv, 7, W - 2 * MARGIN).slice(0, 2)) {
    page.drawText(line, { x: MARGIN, y: dy, size: 7, font: helv, color: MUTED });
    dy -= 9;
  }
}

/* ───────────────────────── primitives ───────────────────────── */

/** Resolve a possibly-relative logo URL against the app origin. */
function absUrl(url: string): string {
  if (/^(https?:|data:)/i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  if (!base) return url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function embedLogo(doc: PDFDocument, rawUrl?: string | null): Promise<PDFImage | null> {
  if (!rawUrl) return null;
  try {
    const url = absUrl(rawUrl);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("png") || /\.png(\?|$)/i.test(url)) return await doc.embedPng(bytes);
    if (ct.includes("jpeg") || ct.includes("jpg") || /\.jpe?g(\?|$)/i.test(url)) return await doc.embedJpg(bytes);
    try { return await doc.embedPng(bytes); } catch { /* not png */ }
    try { return await doc.embedJpg(bytes); } catch { /* not jpg */ }
    return null;
  } catch {
    return null;
  }
}

function drawGradientStrip(page: PDFPage, x: number, y: number, w: number, h: number, c1: RGB, c2: RGB) {
  const segs = 48;
  const sw = w / segs;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const col = rgb(
      c1.red + (c2.red - c1.red) * t,
      c1.green + (c2.green - c1.green) * t,
      c1.blue + (c2.blue - c1.blue) * t
    );
    page.drawRectangle({ x: x + i * sw, y, width: sw + 0.6, height: h, color: col });
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth || !cur) cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
function ascii(s: string): string {
  if (!s) return "";
  return s
    .replace(/₹/g, "Rs ")
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[''‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}
function hexToRgb(hex: string | null | undefined): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return DEFAULT_PRIMARY;
  const parts = m[1].match(/.{2}/g)!;
  const [r, g, b] = parts.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
