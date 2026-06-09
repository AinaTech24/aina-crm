/**
 * Server-rendered investment-proposal PDF (pdf-lib, no headless Chrome).
 *
 * Mirrors the statement letterhead — firm logo + ARN + a theme-colour gradient
 * rule — then lays out the proposal summary (investment, projected corpus,
 * risk), the recommended products grouped by kind, and the cover note. Returned
 * as a Buffer so the proposal "Send via email" route can attach it directly.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";

export type ProposalBrand = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  euin?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
};

export type ProposalData = {
  title?: string | null;
  proposalNumber?: string | null;
  recipientName?: string | null;
  coverLetter?: string | null;
  totalInvestment?: number | string | null;
  expectedCorpus?: number | string | null;
  riskRating?: string | null;
  validUntil?: string | Date | null;
  products?: Array<Record<string, any>> | null;
};

const ACCENT: RGB = rgb(0.055, 0.647, 0.914);
const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.58, 0.64, 0.72);
const GREEN: RGB = rgb(0.02, 0.6, 0.41);
const LINE: RGB = rgb(0.89, 0.91, 0.94);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);

const KIND_TITLE: Record<string, string> = {
  mf: "Mutual Funds", insurance: "Insurance", pms: "Portfolio Management Services", aif: "Alternative Investment Funds",
};
const DISCLAIMER =
  "Mutual Fund investments are subject to market risks. Read all scheme related documents carefully. " +
  "Projections are illustrative, not guaranteed.";

export async function renderProposalPdf(args: { proposal: ProposalData; brand: ProposalBrand; generatedAt?: string }): Promise<Buffer> {
  const { proposal: p, brand } = args;
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const primary = hexToRgb(brand.primaryColor);
  const secondary = brand.secondaryColor ? hexToRgb(brand.secondaryColor) : ACCENT;

  doc.setTitle(ascii(`Proposal ${p.proposalNumber ?? ""} — ${p.recipientName ?? "Client"}`));
  doc.setProducer("Aina CRM");

  let page = doc.addPage([595.28, 841.89]);
  const W = page.getWidth();
  const H = page.getHeight();
  const margin = 44;

  // ── Letterhead: logo (the brand) + ARN + theme gradient. ──
  const logo = await embedLogo(doc, brand.logoUrl);
  const topY = H - margin;
  let arnY = topY - 30;
  if (logo) {
    const maxH = 40, maxW = 200;
    let dw = (logo.width / logo.height) * maxH;
    let dh = maxH;
    if (dw > maxW) { dw = maxW; dh = (logo.height / logo.width) * maxW; }
    page.drawImage(logo, { x: margin, y: topY - dh, width: dw, height: dh });
    arnY = topY - dh - 11;
  } else {
    page.drawText(ascii(brand.legalName ?? brand.displayName ?? "Your Advisor"), { x: margin, y: topY - 15, size: 14, font: bold, color: INK });
    arnY = topY - 30;
  }
  page.drawText(
    ascii(`ARN ${(brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}${brand.euin ? ` - EUIN ${brand.euin}` : ""}`),
    { x: margin, y: arnY, size: 9, font: helv, color: SLATE }
  );
  const titleLabel = "INVESTMENT PROPOSAL";
  const tlW = bold.widthOfTextAtSize(titleLabel, 11);
  page.drawText(titleLabel, { x: W - margin - tlW, y: topY - 13, size: 11, font: bold, color: primary });
  if (p.proposalNumber) {
    const pn = ascii(p.proposalNumber);
    const pnW = helv.widthOfTextAtSize(pn, 9);
    page.drawText(pn, { x: W - margin - pnW, y: topY - 28, size: 9, font: helv, color: SLATE });
  }
  const stripY = Math.min(arnY - 12, topY - 56);
  drawGradientStrip(page, margin, stripY, W - 2 * margin, 5, primary, secondary);

  let y = stripY - 26;

  // ── Title + recipient ──
  page.drawText(ascii(p.title ?? "Investment Proposal"), { x: margin, y, size: 16, font: bold, color: INK });
  y -= 18;
  page.drawText(ascii(`Prepared for ${p.recipientName ?? "Client"}`), { x: margin, y, size: 10, font: helv, color: SLATE });
  y -= 26;

  // ── Summary cards ──
  const cards: Array<{ label: string; value: string; tone?: RGB }> = [
    { label: "Total investment", value: inr(p.totalInvestment) },
    { label: "Projected corpus", value: inr(p.expectedCorpus), tone: GREEN },
    { label: "Risk rating", value: p.riskRating ? ascii(p.riskRating) : "—" },
    { label: "Valid until", value: p.validUntil ? fmtDate(p.validUntil) : "—" },
  ];
  const gap = 10;
  const cardW = (W - 2 * margin - gap * (cards.length - 1)) / cards.length;
  const cardH = 50;
  cards.forEach((c, i) => {
    const x = margin + i * (cardW + gap);
    page.drawRectangle({ x, y: y - cardH, width: cardW, height: cardH, color: rgb(0.97, 0.98, 0.99), borderColor: LINE, borderWidth: 1 });
    page.drawText(ascii(c.label).toUpperCase(), { x: x + 8, y: y - 15, size: 6.6, font: bold, color: MUTED });
    const vs = fitText(ascii(c.value), bold, 12, cardW - 14, 8);
    page.drawText(ascii(c.value), { x: x + 8, y: y - 36, size: vs, font: bold, color: c.tone ?? INK });
  });
  y -= cardH + 28;

  // ── Recommended products, grouped by kind ──
  page.drawText("RECOMMENDED PRODUCTS", { x: margin, y, size: 9, font: bold, color: primary });
  y -= 6;
  page.drawRectangle({ x: margin, y: y - 2, width: W - 2 * margin, height: 1, color: LINE });
  y -= 16;

  const products = (p.products ?? []) as any[];
  const groups: Record<string, any[]> = {};
  for (const it of products) {
    const k = it?.kind ?? "mf";
    (groups[k] ??= []).push(it);
  }
  const ensureSpace = (need: number) => {
    if (y - need < 90) {
      page = doc.addPage([595.28, 841.89]);
      y = H - margin;
    }
  };
  for (const [kind, items] of Object.entries(groups)) {
    ensureSpace(24);
    page.drawText(ascii(KIND_TITLE[kind] ?? kind).toUpperCase(), { x: margin, y, size: 7.5, font: bold, color: MUTED });
    y -= 14;
    for (const it of items) {
      ensureSpace(16);
      const name = it.schemeName ?? it.policyName ?? it.strategyName ?? it.fundName ?? "—";
      const extra = [it.amcName, it.insurer, it.manager].filter(Boolean).join(" - ");
      const amt = it.amount ?? it.investmentAmount ?? it.sumAssured ?? null;
      page.drawText(truncate(ascii(name) + (extra ? `  (${ascii(extra)})` : ""), helv, 9.5, W - 2 * margin - 90), { x: margin, y, size: 9.5, font: helv, color: INK });
      if (amt != null) drawRight(page, bold, inr(amt), W - margin, y, 9.5, INK);
      y -= 16;
    }
    y -= 6;
  }

  // ── Cover note ──
  if (p.coverLetter && p.coverLetter.trim()) {
    ensureSpace(40);
    y -= 4;
    page.drawText("NOTE", { x: margin, y, size: 7.5, font: bold, color: MUTED });
    y -= 13;
    for (const line of wrap(ascii(p.coverLetter), helv, 9, W - 2 * margin).slice(0, 10)) {
      ensureSpace(13);
      page.drawText(line, { x: margin, y, size: 9, font: helv, color: SLATE });
      y -= 13;
    }
  }

  // ── Footer on every page ──
  for (const pg of doc.getPages()) drawFooter(pg, { helv, bold, brand, generatedAt });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/* ── helpers (self-contained, mirror the statement PDF) ── */
function drawFooter(page: PDFPage, a: { helv: PDFFont; bold: PDFFont; brand: ProposalBrand; generatedAt: string }) {
  const W = page.getWidth();
  const margin = 44;
  page.drawRectangle({ x: margin, y: 52, width: W - 2 * margin, height: 1, color: LINE });
  const legal = ascii(a.brand.legalName ?? a.brand.displayName ?? "Your Advisor");
  const arn = ascii(`ARN-${(a.brand.arn ?? "—").toString().replace(/^ARN-?/i, "")}`);
  page.drawText(`${legal}  -  ${arn}`, { x: margin, y: 40, size: 8, font: a.bold, color: SLATE });
  let dy = 26;
  for (const line of wrap(DISCLAIMER, a.helv, 7, W - 2 * margin).slice(0, 2)) {
    page.drawText(line, { x: margin, y: dy, size: 7, font: a.helv, color: MUTED });
    dy -= 9;
  }
}
function drawRight(page: PDFPage, font: PDFFont, t: string, x: number, y: number, size: number, color: RGB) {
  page.drawText(t, { x: x - font.widthOfTextAtSize(t, size), y, size, font, color });
}
function absUrl(url: string): string {
  if (/^(https?:|data:)/i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${url.startsWith("/") ? "" : "/"}${url}` : url;
}
async function embedLogo(doc: PDFDocument, rawUrl?: string | null): Promise<PDFImage | null> {
  if (!rawUrl) return null;
  try {
    const res = await fetch(absUrl(rawUrl), { cache: "no-store" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("png")) return await doc.embedPng(bytes);
    if (ct.includes("jpeg") || ct.includes("jpg")) return await doc.embedJpg(bytes);
    try { return await doc.embedPng(bytes); } catch {}
    try { return await doc.embedJpg(bytes); } catch {}
    return null;
  } catch { return null; }
}
function drawGradientStrip(page: PDFPage, x: number, y: number, w: number, h: number, c1: RGB, c2: RGB) {
  const segs = 48;
  const sw = w / segs;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    page.drawRectangle({ x: x + i * sw, y, width: sw + 0.6, height: h, color: rgb(c1.red + (c2.red - c1.red) * t, c1.green + (c2.green - c1.green) * t, c1.blue + (c2.blue - c1.blue) * t) });
  }
}
function inr(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (v == null || !isFinite(v as number)) return "Rs 0";
  return "Rs " + Math.round(v as number).toLocaleString("en-IN");
}
function fmtDate(iso: string | Date): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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
  const lines: string[] = [];
  for (const para of (text || "").split(/\n/)) {
    let cur = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth || !cur) cur = trial;
      else { lines.push(cur); cur = w; }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [""];
}
function ascii(s: string): string {
  if (!s) return "";
  return s.replace(/₹/g, "Rs ").replace(/[•]/g, "-").replace(/[–—]/g, "-").replace(/[''‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, "-").replace(/[^\x20-\x7E]/g, "").trim();
}
function hexToRgb(hex: string | null | undefined): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return DEFAULT_PRIMARY;
  const [r, g, b] = m[1].match(/.{2}/g)!.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
