/**
 * Tax Package PDF — one client, one FY, on the firm's letterhead.
 *
 *   1. Summary cards      STCG · LTCG · LTCG taxable (after ₹1.25 L) · IDCW income
 *   2. Realised gains     every FIFO-matched redemption leg in the FY
 *   3. IDCW received      payouts + reinvestments in the FY
 *   4. Unrealised position open lots priced at the latest NAV, as of generation
 *   5. Disclaimer         indicative; confirm with the RTA statement before filing
 *
 * Built on the same pdf-lib helpers as the valuation statement (header,
 * continuation header, page numbers, fonts) so every PDF the firm sends looks
 * like it came from one place. SERVER-ONLY.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { drawReportHeader, drawContinuationHeader, drawPageNumbers } from "@/lib/pdf/report-header";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import type { RealizedGains } from "@/lib/tax/realized-gains";
import type { DividendEntry, NotionalLot } from "@/lib/tax/firm-gains";
import { fyLabel } from "@/lib/tax/firm-gains";

const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.58, 0.64, 0.72);
const GREEN: RGB = rgb(0.02, 0.6, 0.41);
const RED: RGB = rgb(0.86, 0.15, 0.15);
const LINE: RGB = rgb(0.89, 0.91, 0.94);
const AINA_RED: RGB = rgb(0.718, 0.102, 0.125);

export type TaxPackageArgs = {
  investor: { name: string; pan: string | null };
  brand: { displayName?: string | null; legalName?: string | null; arn?: string | null; primaryColor?: string | null; secondaryColor?: string | null };
  fy: number;
  realised: RealizedGains;
  dividends: DividendEntry[];
  notional: { lots: NotionalLot[]; asOf: string };
  generatedAt: string;
};

export async function renderTaxPackagePdf(args: TaxPackageArgs): Promise<Buffer> {
  const { investor, brand, fy, realised, dividends, notional } = args;
  const doc = await PDFDocument.create();
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  const san = (s: string) => pdfSanitize(s ?? "", rupeeOk);
  const rupee = rupeeOk ? "₹" : "Rs ";
  const primary = hexToRgb(brand.primaryColor) ?? AINA_RED;
  const secondary = hexToRgb(brand.secondaryColor) ?? primary;
  const firmName = brand.legalName ?? brand.displayName ?? "Your Advisor";
  const title = `TAX PACKAGE — ${fyLabel(fy).toUpperCase()}`;

  doc.setTitle(san(`Tax package ${fyLabel(fy)} — ${investor.name}`));
  doc.setProducer("Aina CRM");
  doc.setAuthor(san(firmName));

  let page: PDFPage = doc.addPage([595.28, 841.89]); // A4
  const W = page.getWidth();
  const H = page.getHeight();
  const M = 40;
  const BOTTOM = 70;
  let y = H;

  const newPage = () => {
    page = doc.addPage([595.28, 841.89]);
    y = drawContinuationHeader({ page, helv, bold, pageWidth: W, pageHeight: H, margin: M, firmName, title: `Tax package ${fyLabel(fy)}`, primary });
  };
  const ensure = (need: number) => { if (y - need < BOTTOM) newPage(); };
  const money = (n: number | null | undefined, signed = false) => {
    if (n == null || !Number.isFinite(n)) return "—";
    const abs = rupee + Math.round(Math.abs(n)).toLocaleString("en-IN");
    return n < 0 ? `-${abs}` : signed && n > 0 ? `+${abs}` : abs;
  };
  const text = (s: string, x: number, size: number, font: PDFFont, color: RGB, right = false) => {
    const str = san(s);
    const tw = right ? font.widthOfTextAtSize(str, size) : 0;
    page.drawText(str, { x: right ? x - tw : x, y, size, font, color });
  };
  const clip = (s: string, font: PDFFont, size: number, maxW: number) => {
    let out = san(s);
    while (out.length > 3 && font.widthOfTextAtSize(out, size) > maxW) out = out.slice(0, -2);
    return out.length < san(s).length ? out.trimEnd() + "…" : out;
  };
  const sectionTitle = (label: string) => {
    ensure(40);
    text(label.toUpperCase(), M, 9, bold, primary);
    y -= 6;
    page.drawRectangle({ x: M, y: y - 2, width: W - 2 * M, height: 1, color: LINE });
    y -= 16;
  };
  const rule = () => page.drawRectangle({ x: M, y: y + 9, width: W - 2 * M, height: 0.5, color: LINE });

  // ── Letterhead ────────────────────────────────────────────────────────
  y = drawReportHeader({
    page, helv, bold, pageWidth: W, pageHeight: H, margin: M,
    logo: null,
    firmName,
    title,
    subtitles: [`Generated ${fmtDate(args.generatedAt)}`, `Unrealised position as of ${fmtDate(notional.asOf)}`],
    arn: brand.arn,
    primary, secondary,
  });

  // ── Client line ───────────────────────────────────────────────────────
  text(investor.name || "Client", M, 15, bold, INK);
  if (investor.pan) { y -= 16; text(`PAN ${investor.pan}`, M, 9.5, helv, SLATE); y += 16; }
  y -= 44;

  // ── Summary cards ─────────────────────────────────────────────────────
  const idcw = dividends.reduce((s, d) => s + d.amount, 0);
  const cards: Array<{ label: string; value: string; tone?: RGB }> = [
    { label: "Short-term gain", value: money(realised.stcg, true), tone: realised.stcg < 0 ? RED : INK },
    { label: "Long-term gain", value: money(realised.ltcg, true), tone: realised.ltcg < 0 ? RED : INK },
    { label: `LTCG taxable (after ${rupee}1.25 L)`, value: realised.ltcgTaxable > 0 ? money(realised.ltcgTaxable) : "Nil", tone: realised.ltcgTaxable > 0 ? RED : GREEN },
    { label: "IDCW income", value: money(idcw) },
  ];
  const gap = 10;
  const cardW = (W - 2 * M - gap * (cards.length - 1)) / cards.length;
  const cardH = 54;
  cards.forEach((c, i) => {
    const x = M + i * (cardW + gap);
    page.drawRectangle({ x, y: y - cardH, width: cardW, height: cardH, color: rgb(0.97, 0.98, 0.99), borderColor: LINE, borderWidth: 1 });
    page.drawText(san(c.label).toUpperCase(), { x: x + 8, y: y - 16, size: 6.4, font: bold, color: MUTED });
    page.drawText(san(c.value), { x: x + 8, y: y - 38, size: 12, font: bold, color: c.tone ?? INK });
  });
  y -= cardH + 30;

  // ── 1. Realised gains ─────────────────────────────────────────────────
  sectionTitle(`Realised capital gains · ${realised.rows.length} redemption leg${realised.rows.length === 1 ? "" : "s"}`);
  {
    const cScheme = M, cBought = M + 190, cSold = M + 245, cUnits = M + 320, cBuy = M + 375, cSell = M + 430, cGain = W - M - 34, cTerm = W - M;
    const head = () => {
      text("SCHEME", cScheme, 7, bold, MUTED); text("BOUGHT", cBought, 7, bold, MUTED); text("SOLD", cSold, 7, bold, MUTED);
      text("UNITS", cUnits, 7, bold, MUTED, true); text("BUY NAV", cBuy, 7, bold, MUTED, true); text("SELL NAV", cSell, 7, bold, MUTED, true);
      text("GAIN", cGain, 7, bold, MUTED, true); text("TERM", cTerm, 7, bold, MUTED, true);
      y -= 13;
    };
    head();
    if (realised.rows.length === 0) { text("No redemptions in this financial year.", M, 8.5, helv, SLATE); y -= 16; }
    for (const r of realised.rows) {
      if (y - 14 < BOTTOM) { newPage(); head(); }
      text(clip(r.schemeName ?? r.schemeCode ?? "Scheme", helv, 8, 185), cScheme, 8, helv, INK);
      text(fmtDate(r.buyDate), cBought, 8, helv, SLATE); text(fmtDate(r.sellDate), cSold, 8, helv, SLATE);
      text(r.units.toFixed(3), cUnits, 8, helv, INK, true); text(r.buyNav.toFixed(2), cBuy, 8, helv, INK, true); text(r.sellNav.toFixed(2), cSell, 8, helv, INK, true);
      text(money(r.gain, true), cGain, 8, bold, r.gain < 0 ? RED : GREEN, true);
      text(r.term.toUpperCase(), cTerm, 7.5, bold, r.term === "ltcg" ? SLATE : MUTED, true);
      rule();
      y -= 14;
    }
    y -= 4;
    ensure(30);
    text(`Proceeds ${money(realised.totalProceeds)}   ·   Cost ${money(realised.totalCost)}   ·   STCG ${money(realised.stcg, true)}   ·   LTCG ${money(realised.ltcg, true)}`, M, 8, bold, SLATE);
    y -= 24;
  }

  // ── 2. IDCW ───────────────────────────────────────────────────────────
  sectionTitle(`Dividend / IDCW received · ${money(idcw)}`);
  {
    const cDate = M, cScheme = M + 70, cType = W - M - 110, cAmt = W - M;
    const head = () => { text("DATE", cDate, 7, bold, MUTED); text("SCHEME", cScheme, 7, bold, MUTED); text("TYPE", cType, 7, bold, MUTED, true); text("AMOUNT", cAmt, 7, bold, MUTED, true); y -= 13; };
    head();
    if (dividends.length === 0) { text("No IDCW in this financial year (growth-plan holdings pay none).", M, 8.5, helv, SLATE); y -= 16; }
    for (const d of dividends) {
      if (y - 14 < BOTTOM) { newPage(); head(); }
      text(fmtDate(d.date), cDate, 8, helv, SLATE);
      text(clip(d.scheme ?? "Scheme", helv, 8, cType - cScheme - 90), cScheme, 8, helv, INK);
      text(d.type === "dividend_payout" ? "Payout" : "Reinvested", cType, 8, helv, SLATE, true);
      text(money(d.amount), cAmt, 8, bold, INK, true);
      rule();
      y -= 14;
    }
    y -= 18;
  }

  // ── 3. Unrealised position ────────────────────────────────────────────
  const lots = notional.lots;
  const priced = lots.filter((l) => l.value != null);
  const cur = priced.reduce((s, l) => s + (l.value ?? 0), 0);
  const cost = lots.reduce((s, l) => s + l.cost, 0);
  const unreal = priced.reduce((s, l) => s + (l.gain ?? 0), 0);
  sectionTitle(`Unrealised position as of ${fmtDate(notional.asOf)} · ${lots.length} open lot${lots.length === 1 ? "" : "s"}`);
  {
    const cScheme = M, cDate = M + 215, cUnits = M + 290, cCost = M + 350, cNav = M + 410, cGain = W - M - 30, cTerm = W - M;
    const head = () => {
      text("SCHEME", cScheme, 7, bold, MUTED); text("PURCHASED", cDate, 7, bold, MUTED); text("UNITS", cUnits, 7, bold, MUTED, true);
      text("COST NAV", cCost, 7, bold, MUTED, true); text("LATEST NAV", cNav, 7, bold, MUTED, true); text("GAIN", cGain, 7, bold, MUTED, true); text("TERM", cTerm, 7, bold, MUTED, true);
      y -= 13;
    };
    head();
    if (lots.length === 0) { text("No open holdings.", M, 8.5, helv, SLATE); y -= 16; }
    for (const l of lots) {
      if (y - 14 < BOTTOM) { newPage(); head(); }
      text(clip(l.scheme ?? l.schemeCode ?? "Scheme", helv, 8, 210), cScheme, 8, helv, INK);
      text(fmtDate(l.date), cDate, 8, helv, SLATE);
      text(l.units.toFixed(3), cUnits, 8, helv, INK, true);
      text(l.costNav.toFixed(2), cCost, 8, helv, INK, true);
      text(l.nav != null ? l.nav.toFixed(2) : "n/a", cNav, 8, helv, l.nav != null ? INK : MUTED, true);
      text(l.gain != null ? money(l.gain, true) : "unpriced", cGain, 8, bold, l.gain == null ? MUTED : l.gain < 0 ? RED : GREEN, true);
      text(l.term.toUpperCase(), cTerm, 7.5, bold, l.term === "lt" ? SLATE : MUTED, true);
      rule();
      y -= 14;
    }
    y -= 4;
    ensure(30);
    text(`Cost ${money(cost)}   ·   Current value ${money(cur)}   ·   Unrealised ${money(unreal, true)}${lots.length - priced.length ? `   ·   ${lots.length - priced.length} lot(s) unpriced` : ""}`, M, 8, bold, SLATE);
    y -= 24;
  }

  // ── Disclaimer (last page) ────────────────────────────────────────────
  ensure(60);
  const disclaimer =
    "Indicative working from transactions recorded with the distributor, using FIFO lot matching, equity-fund rules and the " +
    "current-year LTCG exemption. Grandfathering (NAV as on 31-Jan-2018), exact equity/debt classification, TDS and surcharge are " +
    "not applied. Please reconcile with the AMC / RTA capital-gains statement before filing your return. Mutual Fund investments " +
    "are subject to market risks; read all scheme related documents carefully.";
  for (const line of wrap(san(disclaimer), helv, 7, W - 2 * M)) { text(line, M, 7, helv, MUTED); y -= 9.5; }

  drawPageNumbers(doc, helv, W, 28);
  return Buffer.from(await doc.save());
}

/* ───────────────────────── helpers ───────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function hexToRgb(hex: string | null | undefined): RGB | null {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function wrap(s: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
