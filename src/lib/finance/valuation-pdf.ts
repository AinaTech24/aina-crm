/**
 * Server-rendered portfolio valuation statement (PDF).
 *
 * Builds an emailable/printable one-page statement from the LIVE valuation
 * engine (valueInvestor + AMFI NAV) — not the stale stored figures. Pure
 * pdf-lib, no native deps / no headless Chrome. Returns a Buffer the API route
 * streams as application/pdf or attaches to an email.
 *
 * SEBI hygiene: every page carries the firm name + ARN + the standard market-
 * risk disclaimer. Helvetica is WinAnsi-only, so all dynamic text passes
 * through ascii() (₹ → "Rs ", smart-quotes/dashes normalised) before drawing.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { InvestorValuation } from "./valuation";

export type StatementInvestor = {
  name: string | null;
  pan: string | null;
  clientCode?: string | null;
};

export type StatementBrand = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  euin?: string | null;
  primaryColor?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
};

const ACCENT: RGB = rgb(0.055, 0.647, 0.914);
const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.58, 0.64, 0.72);
const WHITE: RGB = rgb(1, 1, 1);
const GREEN: RGB = rgb(0.02, 0.6, 0.41);
const RED: RGB = rgb(0.86, 0.15, 0.15);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);
const LINE: RGB = rgb(0.89, 0.91, 0.94);

const DISCLAIMER =
  "Mutual Fund investments are subject to market risks. Read all scheme related documents carefully. " +
  "Valuation is computed from recorded transactions priced at the latest available NAV and is indicative.";

export type RenderStatementArgs = {
  valuation: InvestorValuation;
  investor: StatementInvestor;
  brand: StatementBrand;
  /** ISO date the statement was generated (injected for determinism). */
  generatedAt: string;
};

export async function renderValuationStatementPdf(args: RenderStatementArgs): Promise<Buffer> {
  const { valuation: v, investor, brand } = args;
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const primary = hexToRgb(brand.primaryColor);

  doc.setTitle(ascii(`Portfolio statement — ${investor.name ?? "Client"}`));
  doc.setProducer("MFD Growth OS");
  if (brand.legalName || brand.displayName) doc.setAuthor(ascii(brand.legalName ?? brand.displayName ?? ""));

  const page = doc.addPage([595.28, 841.89]); // A4
  const W = page.getWidth();
  const H = page.getHeight();
  const margin = 44;
  let y = H;

  // ── Header band ───────────────────────────────────────────────────────
  const bandH = 92;
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: primary });
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: 4, color: ACCENT });
  page.drawText(ascii(brand.displayName ?? brand.legalName ?? "Your Advisor"), {
    x: margin, y: H - 40, size: 18, font: bold, color: WHITE,
  });
  page.drawText(
    ascii(`ARN ${(brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}${brand.euin ? ` · EUIN ${brand.euin}` : ""}`),
    { x: margin, y: H - 58, size: 10, font: helv, color: WHITE, opacity: 0.85 }
  );
  const titleLabel = "PORTFOLIO STATEMENT";
  const tlW = bold.widthOfTextAtSize(titleLabel, 11);
  page.drawText(titleLabel, { x: W - margin - tlW, y: H - 40, size: 11, font: bold, color: WHITE });
  const asOfLabel = ascii(`As of ${fmtDate(v.asOf ?? args.generatedAt)}`);
  const aoW = helv.widthOfTextAtSize(asOfLabel, 9);
  page.drawText(asOfLabel, { x: W - margin - aoW, y: H - 56, size: 9, font: helv, color: WHITE, opacity: 0.85 });

  y = H - bandH - 28;

  // ── Client line ───────────────────────────────────────────────────────
  page.drawText(ascii(investor.name ?? "Client"), { x: margin, y, size: 15, font: bold, color: INK });
  const idBits = [
    investor.pan ? `PAN ${investor.pan}` : null,
    investor.clientCode ? `Code ${investor.clientCode}` : null,
  ].filter(Boolean).join("   ·   ");
  if (idBits) page.drawText(ascii(idBits), { x: margin, y: y - 16, size: 9.5, font: helv, color: SLATE });
  y -= 44;

  // ── Summary cards ─────────────────────────────────────────────────────
  const gainPositive = (v.gain ?? 0) >= 0;
  const cards: Array<{ label: string; value: string; tone?: RGB }> = [
    { label: "Current value", value: inr(v.currentValue) },
    { label: "Net invested", value: inr(v.pricedInvested) },
    { label: "Total gain", value: `${gainPositive ? "+" : ""}${inr(v.gain)}`, tone: gainPositive ? GREEN : RED },
    {
      label: "Absolute return",
      value: v.absoluteReturn != null ? pct(v.absoluteReturn) : "—",
      tone: (v.absoluteReturn ?? 0) >= 0 ? GREEN : RED,
    },
    {
      label: "XIRR (p.a.)",
      value: v.xirr != null ? pct(v.xirr) : "—",
      tone: (v.xirr ?? 0) >= 0 ? GREEN : RED,
    },
  ];
  const gap = 10;
  const cardW = (W - 2 * margin - gap * (cards.length - 1)) / cards.length;
  const cardH = 54;
  cards.forEach((c, i) => {
    const x = margin + i * (cardW + gap);
    page.drawRectangle({ x, y: y - cardH, width: cardW, height: cardH, color: rgb(0.97, 0.98, 0.99), borderColor: LINE, borderWidth: 1 });
    page.drawText(ascii(c.label).toUpperCase(), { x: x + 8, y: y - 16, size: 6.6, font: bold, color: MUTED });
    const vs = fitText(ascii(c.value), bold, 12, cardW - 14, 8);
    page.drawText(ascii(c.value), { x: x + 8, y: y - 38, size: vs, font: bold, color: c.tone ?? INK });
  });
  y -= cardH + 30;

  // ── Holdings table ────────────────────────────────────────────────────
  page.drawText("HOLDINGS", { x: margin, y, size: 9, font: bold, color: primary });
  y -= 6;
  page.drawRectangle({ x: margin, y: y - 2, width: W - 2 * margin, height: 1, color: LINE });
  y -= 16;

  // Column layout
  const colScheme = margin;
  const colUnits = margin + 250;
  const colNav = margin + 330;
  const colVal = W - margin;
  const header = (t: string, x: number, right = false) => {
    const size = 7.5;
    const tw = right ? helv.widthOfTextAtSize(t, size) : 0;
    page.drawText(t, { x: right ? x - tw : x, y, size, font: bold, color: MUTED });
  };
  header("SCHEME", colScheme);
  header("UNITS", colUnits, true);
  header("NAV", colNav, true);
  header("VALUE", colVal, true);
  y -= 14;

  const priced = v.holdings.filter((h) => h.priced && (h.currentValue ?? 0) > 0);
  const rows = priced.length ? priced : v.holdings.slice(0, 12);
  for (const h of rows) {
    if (y < 130) break; // keep room for footer; (single-page statement by design)
    const name = ascii(h.schemeName ?? h.schemeCode ?? "—");
    page.drawText(truncate(name, helv, 9, colUnits - colScheme - 12), { x: colScheme, y, size: 9, font: helv, color: INK });
    drawRight(page, helv, num(h.netUnits, 3), colUnits, y, 8.5, SLATE);
    drawRight(page, helv, h.latestNav != null ? num(h.latestNav, 2) : "—", colNav, y, 8.5, SLATE);
    drawRight(page, bold, h.currentValue != null ? inr(h.currentValue) : "—", colVal, y, 9, INK);
    y -= 16;
  }

  if (v.unpricedSchemes > 0 && y > 120) {
    y -= 4;
    page.drawText(
      ascii(`Note: ${v.unpricedSchemes} holding(s) could not be priced against a live NAV and are excluded from the value/return above.`),
      { x: margin, y, size: 7.5, font: helv, color: MUTED }
    );
    y -= 14;
  }

  // ── Footer (firm · ARN · disclaimer · generated) ──────────────────────
  drawFooter(page, { helv, bold, brand, primary, generatedAt: args.generatedAt });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/* ───────────────────────── helpers ───────────────────────── */

function drawFooter(
  page: PDFPage,
  a: { helv: PDFFont; bold: PDFFont; brand: StatementBrand; primary: RGB; generatedAt: string }
) {
  const W = page.getWidth();
  const margin = 44;
  page.drawRectangle({ x: 0, y: 0, width: W, height: 56, color: rgb(0.97, 0.98, 0.99) });
  page.drawRectangle({ x: 0, y: 56, width: W, height: 1.5, color: a.primary, opacity: 0.85 });
  const legal = ascii(a.brand.legalName ?? a.brand.displayName ?? "Your Advisor");
  const arn = ascii(`ARN ${(a.brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}`);
  page.drawText(`${legal}  ·  ${arn}`, { x: margin, y: 40, size: 8, font: a.bold, color: SLATE });
  const gen = ascii(`Generated ${fmtDateTime(a.generatedAt)}`);
  const gw = a.helv.widthOfTextAtSize(gen, 7.5);
  page.drawText(gen, { x: W - margin - gw, y: 40, size: 7.5, font: a.helv, color: MUTED });
  let dy = 26;
  for (const line of wrap(DISCLAIMER, a.helv, 7, W - 2 * margin).slice(0, 2)) {
    page.drawText(line, { x: margin, y: dy, size: 7, font: a.helv, color: MUTED });
    dy -= 9;
  }
}

function drawRight(page: PDFPage, font: PDFFont, t: string, x: number, y: number, size: number, color: RGB) {
  const w = font.widthOfTextAtSize(t, size);
  page.drawText(t, { x: x - w, y, size, font, color });
}

function inr(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "Rs 0";
  return "Rs " + Math.round(n).toLocaleString("en-IN");
}
function num(n: number | null | undefined, dp: number): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function pct(dec: number): string {
  return `${dec >= 0 ? "+" : ""}${(dec * 100).toFixed(2)}%`;
}
function fmtDate(iso: string | null): string {
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
function fitText(text: string, font: PDFFont, size: number, maxWidth: number, min: number): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  return s;
}
function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
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
