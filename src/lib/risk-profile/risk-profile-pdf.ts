/**
 * Server-rendered Risk Profile Report (PDF).
 *
 * Four-part report in the format MFDs hand to clients:
 *   1. Cover — risk band + score ring, "Prepared on / for / by" with the client's
 *      address and the firm's letterhead (AMFI-registered distributor, ARN, address).
 *   2. Your risk category — every band of the firm's template on a ladder with the
 *      client's band highlighted, what it means, indicative asset allocation.
 *   3. Questionnaire — every question with ALL its options, the chosen one marked
 *      (falls back to the recorded answer alone when the template no longer has
 *      that question).
 *   4. Declaration + signature / verification block, audit footer on every page.
 *
 * Pure pdf-lib (no native deps), branded with the firm's colours, matching the
 * portfolio-statement PDF. Helvetica is WinAnsi-only, so all dynamic text passes
 * through ascii() (₹ → "Rs ", smart-quotes/dashes normalised) before drawing.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
import { drawReportHeader, drawContinuationHeader, drawPageNumbers } from "@/lib/pdf/report-header";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import type { StatementBrand } from "@/lib/finance/valuation-pdf";

export type AllocationKey = "equity" | "debt" | "cash" | "commodities" | "alternatives";
export type RiskAllocation = Partial<Record<AllocationKey, number>>;

export type PostalAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
};

/** Firm letterhead — the shared statement brand plus a postal address. */
export type RiskProfileBrand = StatementBrand & { address?: PostalAddress | null };

export type RiskPdfBand = {
  id: string;
  label: string;
  minScore: number;
  maxScore: number;
  color?: string | null;
  description?: string | null;
  allocation?: RiskAllocation | null;
};

export type RiskPdfQuestion = {
  key: string;
  label: string;
  options: Array<{ value: string; label: string; score: number }>;
};

export type RiskProfilePdfData = {
  /** Band id (template band id; canonical: conservative | moderate | aggressive | very_aggressive). */
  category: string | null;
  totalScore: number | null;
  /** Template's maximum possible score — gives the score context ("24 / 40"). */
  maxScore?: number | null;
  profileDate?: string | null; // yyyy-mm-dd
  signedAt?: string | null; // ISO
  signedByName?: string | null;
  nextReviewAt?: string | null; // yyyy-mm-dd
  age?: number | null;
  verificationMethod?: string | null;
  /** Per-question breakdown, as stored in risk_profile_responses.responses. */
  responses: Array<{ key?: string; question?: string; answer?: string; score?: number | null }>;
  /** The firm's template bands — drives the ladder + asset-allocation page. */
  bands?: RiskPdfBand[] | null;
  /** The firm's template questions — lets the report list every option. */
  questions?: RiskPdfQuestion[] | null;
  /** Optional template description (admin-facing; not printed). */
  templateDescription?: string | null;
  /** Client's uploaded signature / signed form, when it is a PNG or JPEG. */
  signatureImage?: { bytes: Uint8Array; mime: string } | null;
};

export type RiskProfileInvestor = {
  name: string | null;
  pan?: string | null;
  address?: PostalAddress | null;
  email?: string | null;
  phone?: string | null;
};

export type RenderRiskProfileArgs = {
  profile: RiskProfilePdfData;
  investor: RiskProfileInvestor;
  brand: RiskProfileBrand;
  /** ISO date the PDF was generated (injected for determinism). */
  generatedAt: string;
  /** Audit reference (response row id) — printed in the footer as "Ref XXXXXXXX". */
  refId?: string | null;
};

const INK: RGB = rgb(0.06, 0.09, 0.16);
const SLATE: RGB = rgb(0.2, 0.255, 0.333);
const MUTED: RGB = rgb(0.58, 0.64, 0.72);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);
const LINE: RGB = rgb(0.89, 0.91, 0.94);
const PAPER: RGB = rgb(0.975, 0.98, 0.99);
const WHITE: RGB = rgb(1, 1, 1);

const W = 595.28;
const H = 841.89; // A4
const MARGIN = 40;
const CONTENT_W = W - 2 * MARGIN;
const FOOTER_TOP = 56; // body content must stay above this
const COL_GAP = 24;
const COL_W = (CONTENT_W - COL_GAP) / 2;
const LEFT_X = MARGIN;
const RIGHT_X = MARGIN + COL_W + COL_GAP;

// Glyph switch — set per render from the embedded font (process-stable).
let KEEP_RUPEE = false;

const CATEGORY_META: Record<string, { label: string; blurb: string; tone: RGB }> = {
  conservative: {
    label: "Conservative",
    blurb:
      "Prioritises capital protection and stability over high returns. Comfortable with low volatility and predictable income.",
    tone: rgb(0.15, 0.39, 0.92),
  },
  moderate_conservative: {
    label: "Moderately conservative",
    blurb:
      "Leans towards stability but accepts modest, measured exposure to growth assets for better inflation-adjusted returns.",
    tone: rgb(0.05, 0.55, 0.65),
  },
  moderate: {
    label: "Moderate",
    blurb: "Balances growth and stability; accepts measured volatility for better long-term returns.",
    tone: rgb(0.02, 0.6, 0.41),
  },
  balanced: {
    label: "Balanced",
    blurb: "Balances growth and stability; accepts measured volatility for better long-term returns.",
    tone: rgb(0.02, 0.6, 0.41),
  },
  moderate_aggressive: {
    label: "Moderately aggressive",
    blurb: "Seeks growth and accepts meaningful short-term swings, while keeping a cushion of stable assets.",
    tone: rgb(0.93, 0.6, 0.05),
  },
  aggressive: {
    label: "Aggressive",
    blurb: "Seeks high long-term growth and can tolerate significant short-term volatility.",
    tone: rgb(0.85, 0.47, 0.02),
  },
  very_aggressive: {
    label: "Very aggressive",
    blurb: "Maximises growth potential and is comfortable with large swings in value over the investment horizon.",
    tone: rgb(0.86, 0.15, 0.15),
  },
};

/**
 * Indicative allocations, ordered least → most risk-tolerant. Used when a
 * template band carries no explicit allocation: matched by canonical id first,
 * else by the band's relative position on the firm's own ladder.
 */
const ALLOCATION_PRESETS: Array<{ ids: string[]; alloc: Required<RiskAllocation> }> = [
  { ids: ["conservative", "low"], alloc: { equity: 20, debt: 60, cash: 15, commodities: 5, alternatives: 0 } },
  {
    ids: ["moderate_conservative", "moderately_conservative", "cautious"],
    alloc: { equity: 40, debt: 45, cash: 10, commodities: 5, alternatives: 0 },
  },
  { ids: ["moderate", "balanced"], alloc: { equity: 55, debt: 30, cash: 10, commodities: 5, alternatives: 0 } },
  {
    ids: ["moderate_aggressive", "moderately_aggressive", "growth"],
    alloc: { equity: 70, debt: 15, cash: 5, commodities: 5, alternatives: 5 },
  },
  { ids: ["aggressive", "high"], alloc: { equity: 80, debt: 10, cash: 5, commodities: 5, alternatives: 0 } },
  { ids: ["very_aggressive", "very_high"], alloc: { equity: 85, debt: 5, cash: 5, commodities: 5, alternatives: 0 } },
];

const ALLOCATION_ORDER: Array<{ key: AllocationKey; label: string; color: RGB }> = [
  { key: "equity", label: "Equity", color: rgb(0.055, 0.145, 0.341) },
  { key: "debt", label: "Debt", color: rgb(0.02, 0.6, 0.41) },
  { key: "cash", label: "Cash & liquid", color: rgb(0.96, 0.62, 0.04) },
  { key: "commodities", label: "Commodities", color: rgb(0.55, 0.36, 0.96) },
  { key: "alternatives", label: "Alternatives", color: rgb(0.4, 0.45, 0.55) },
];

const DISCLAIMER =
  "This risk profile is based on the client's self-declared responses and is used to assess the suitability of " +
  "investment recommendations. Mutual Fund investments are subject to market risks; read all scheme related documents carefully.";

const DECLARATION =
  "I/We confirm that the responses recorded in this report were given by me/us and are true to the best of my/our " +
  "knowledge. I/We understand that the resulting risk category will be used to assess the suitability of investment " +
  "recommendations, and that this profile should be reviewed periodically and whenever my/our financial circumstances, " +
  "goals or investment horizon change.";

type ResolvedBand = RiskPdfBand & { tone: RGB; isCurrent: boolean };

export async function renderRiskProfilePdf(args: RenderRiskProfileArgs): Promise<Buffer> {
  const { profile, investor, brand } = args;
  const doc = await PDFDocument.create();
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  KEEP_RUPEE = rupeeOk;
  const primary = hexToRgb(brand.primaryColor);
  const logo = await embedLogo(doc, brand.logoUrl);

  const clientName = investor.name ?? "Client";
  const firm = brand.legalName ?? brand.displayName ?? "Your Advisor";
  doc.setTitle(ascii(`Risk profile report — ${clientName}`));
  doc.setProducer("Aina CRM");
  if (brand.legalName || brand.displayName) doc.setAuthor(ascii(firm));
  if (args.refId) doc.setSubject(`Ref ${String(args.refId).slice(0, 8)}`);

  const ctx: Ctx = {
    helv,
    bold,
    primary,
    logo,
    brand,
    generatedAt: args.generatedAt,
    // Letterhead date = when the profile was taken, so it agrees with the cover's
    // "PREPARED ON" block. generatedAt stays in the footer as the audit stamp.
    preparedOn: profile.profileDate ?? args.generatedAt,
    refId: args.refId ?? null,
  };

  // ── Resolve the client's band against the template ladder ─────────────
  const categoryId = (profile.category ?? "").toLowerCase();
  const canonical = CATEGORY_META[categoryId] ?? null;
  const bands: ResolvedBand[] = [...(profile.bands ?? [])]
    .sort((a, b) => a.minScore - b.minScore)
    .map((b) => {
      const meta = CATEGORY_META[b.id.toLowerCase()];
      return {
        ...b,
        tone: hexToRgbOr(b.color, meta?.tone ?? primary),
        isCurrent: b.id.toLowerCase() === categoryId,
      };
    });
  const current = bands.find((b) => b.isCurrent) ?? null;
  const bandLabel =
    current?.label ?? canonical?.label ?? (profile.category ? titleCase(profile.category) : "Not categorised");
  const tone = current?.tone ?? canonical?.tone ?? primary;
  const blurb = (current?.description?.trim() || canonical?.blurb || "").trim();
  const scoreText =
    profile.totalScore != null
      ? profile.maxScore
        ? `${profile.totalScore} / ${profile.maxScore}`
        : String(profile.totalScore)
      : null;
  const allocation = resolveAllocation(current, bands);

  // ═══════════════════════════ 1. COVER ═══════════════════════════════════
  let page = doc.addPage([W, H]);
  let y = drawHeader(page, ctx, true);
  y -= 34;

  // Hero — band label + blurb on the left, score ring on the right.
  const ringR = 46;
  const heroTextW = CONTENT_W - (scoreText ? ringR * 2 + 40 : 0);
  const heroTop = y;
  const heroX = MARGIN + 18;
  page.drawText("YOUR RISK PROFILE", { x: heroX, y, size: 9, font: bold, color: primary });
  y -= 34;
  for (const ln of wrap(ascii(bandLabel), bold, 28, heroTextW - 18).slice(0, 2)) {
    page.drawText(ln, { x: heroX, y, size: 28, font: bold, color: tone });
    y -= 32;
  }
  if (current) {
    page.drawText(
      ascii(`Score band ${current.minScore} - ${current.maxScore}${profile.maxScore ? ` of ${profile.maxScore}` : ""}`),
      { x: heroX, y: y + 8, size: 9, font: helv, color: MUTED }
    );
    y -= 10;
  }
  if (blurb) {
    for (const ln of wrap(ascii(blurb), helv, 10.5, heroTextW - 18).slice(0, 3)) {
      page.drawText(ln, { x: heroX, y, size: 10.5, font: helv, color: SLATE });
      y -= 14;
    }
  }
  // Accent bar spans the whole hero block (drawn once its height is known).
  page.drawRectangle({ x: MARGIN, y: y + 6, width: 4, height: heroTop - y + 6, color: tone });
  if (scoreText) {
    const cx = W - MARGIN - ringR - 6;
    const cy = heroTop - ringR - 4;
    page.drawCircle({ x: cx, y: cy, size: ringR, color: blend(tone, 0.08), borderColor: tone, borderWidth: 4 });
    const scoreSize = scoreText.length > 7 ? 18 : 22;
    const sw = bold.widthOfTextAtSize(scoreText, scoreSize);
    page.drawText(scoreText, { x: cx - sw / 2, y: cy - 4, size: scoreSize, font: bold, color: INK });
    const cap = "RISK SCORE";
    const cw = bold.widthOfTextAtSize(cap, 6.5);
    page.drawText(cap, { x: cx - cw / 2, y: cy - 20, size: 6.5, font: bold, color: MUTED });
    y = Math.min(y, cy - ringR - 8);
  }
  y -= 22;

  // Purpose — why this document exists, in client-facing compliance terms.
  page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: 1, color: LINE });
  y -= 26;
  page.drawText("PURPOSE OF THIS REPORT", { x: MARGIN, y, size: 8, font: bold, color: primary });
  y -= 15;
  const purpose =
    `This report records the outcome of the risk-profiling questionnaire completed by the client and the resulting ` +
    `risk category. ${firm} uses it to assess the suitability of mutual fund schemes before making recommendations, ` +
    `in line with the product-suitability obligations of an AMFI-registered distributor. It should be reviewed at ` +
    `least annually and whenever the client's financial circumstances, goals or investment horizon change.`;
  for (const ln of wrap(ascii(purpose), helv, 9.5, CONTENT_W).slice(0, 5)) {
    page.drawText(ln, { x: MARGIN, y, size: 9.5, font: helv, color: SLATE });
    y -= 13;
  }
  y -= 18;

  // Key facts — four stacked label/value cells in one strip.
  const facts: Array<[string, string]> = [
    ["PREPARED ON", fmtDateLong(profile.profileDate ?? ctx.generatedAt)],
    ["SIGNED ON", profile.signedAt ? fmtDate(profile.signedAt) : "Pending"],
    ["VERIFICATION", profile.verificationMethod ? verificationLabel(profile.verificationMethod) : "Not recorded"],
    ["REVIEW DUE", profile.nextReviewAt ? fmtDate(profile.nextReviewAt) : "Not set"],
  ];
  const cellH = 44;
  const cellW = CONTENT_W / facts.length;
  page.drawRectangle({
    x: MARGIN,
    y: y - cellH,
    width: CONTENT_W,
    height: cellH,
    color: PAPER,
    borderColor: LINE,
    borderWidth: 1,
  });
  facts.forEach(([label, value], i) => {
    const cx = MARGIN + i * cellW;
    if (i > 0) page.drawRectangle({ x: cx, y: y - cellH + 7, width: 0.8, height: cellH - 14, color: LINE });
    page.drawText(label, { x: cx + 12, y: y - 15, size: 7, font: bold, color: MUTED });
    const v = ascii(value);
    const vs = fitSize(v, bold, cellW - 24, 10.5, 8);
    page.drawText(v, { x: cx + 12, y: y - 31, size: vs, font: bold, color: INK });
  });
  y -= cellH + 30;

  const blockTop = y;
  // Prepared for — client
  let ly = blockTop;
  page.drawText("PREPARED FOR", { x: LEFT_X, y: ly, size: 7.5, font: bold, color: MUTED });
  ly -= 16;
  const clientSize = fitSize(ascii(clientName), bold, COL_W, 12.5, 10);
  for (const ln of wrap(ascii(clientName), bold, clientSize, COL_W).slice(0, 2)) {
    page.drawText(ln, { x: LEFT_X, y: ly, size: clientSize, font: bold, color: INK });
    ly -= clientSize + 3;
  }
  const idBits = [investor.pan ? `PAN ${investor.pan}` : null, profile.age != null ? `Age ${profile.age}` : null]
    .filter(Boolean)
    .join("   -   ");
  if (idBits) {
    page.drawText(ascii(idBits), { x: LEFT_X, y: ly, size: 9, font: helv, color: SLATE });
    ly -= 13;
  }
  for (const ln of addressLines(investor.address)) {
    for (const w of wrap(ascii(ln), helv, 9, COL_W).slice(0, 2)) {
      page.drawText(w, { x: LEFT_X, y: ly, size: 9, font: helv, color: SLATE });
      ly -= 12;
    }
  }
  const clientContact = [investor.phone, investor.email].filter(Boolean).join("   -   ");
  if (clientContact) {
    ly -= 2;
    for (const w of wrap(ascii(clientContact), helv, 8.5, COL_W).slice(0, 2)) {
      page.drawText(w, { x: LEFT_X, y: ly, size: 8.5, font: helv, color: MUTED });
      ly -= 11;
    }
  }

  // Prepared by — firm letterhead
  let ry = blockTop;
  page.drawText("PREPARED BY", { x: RIGHT_X, y: ry, size: 7.5, font: bold, color: MUTED });
  ry -= 16;
  const firmSize = fitSize(ascii(firm), bold, COL_W, 12.5, 10);
  for (const ln of wrap(ascii(firm), bold, firmSize, COL_W).slice(0, 2)) {
    page.drawText(ln, { x: RIGHT_X, y: ry, size: firmSize, font: bold, color: INK });
    ry -= firmSize + 3;
  }
  page.drawText("AMFI-Registered Mutual Fund Distributor", { x: RIGHT_X, y: ry, size: 9, font: helv, color: primary });
  ry -= 13;
  const arnNo = brand.arn ? String(brand.arn).replace(/^ARN[-\s]*/i, "") : "";
  const regBits = [arnNo ? `ARN-${arnNo}` : null, brand.euin ? `EUIN ${brand.euin}` : null]
    .filter(Boolean)
    .join("   -   ");
  if (regBits) {
    page.drawText(ascii(regBits), { x: RIGHT_X, y: ry, size: 9, font: helv, color: SLATE });
    ry -= 13;
  }
  for (const ln of addressLines(brand.address)) {
    for (const w of wrap(ascii(ln), helv, 9, COL_W).slice(0, 2)) {
      page.drawText(w, { x: RIGHT_X, y: ry, size: 9, font: helv, color: SLATE });
      ry -= 12;
    }
  }
  const firmContact = [brand.phone, brand.email].filter(Boolean).join("   -   ");
  if (firmContact || brand.website) ry -= 2;
  if (firmContact) {
    for (const w of wrap(ascii(firmContact), helv, 8.5, COL_W).slice(0, 2)) {
      page.drawText(w, { x: RIGHT_X, y: ry, size: 8.5, font: helv, color: MUTED });
      ry -= 11;
    }
  }
  if (brand.website) {
    page.drawText(ascii(String(brand.website).replace(/^https?:\/\//i, "")), {
      x: RIGHT_X,
      y: ry,
      size: 8.5,
      font: helv,
      color: MUTED,
    });
    ry -= 11;
  }

  // Confidentiality line above the footer.
  page.drawText(
    ascii(`Confidential - prepared solely for ${clientName}. Not to be circulated to or relied upon by any other person.`),
    { x: MARGIN, y: FOOTER_TOP + 34, size: 7.5, font: helv, color: MUTED }
  );
  drawFooter(page, ctx);

  // Shared page-break guard for every flowing section below.
  const ensure = (need: number) => {
    if (y - need < FOOTER_TOP + 10) {
      drawFooter(page, ctx);
      page = doc.addPage([W, H]);
      y = drawHeader(page, ctx, false);
    }
  };

  // ═══════════════════════ 2. YOUR RISK CATEGORY ═════════════════════════
  page = doc.addPage([W, H]);
  y = drawHeader(page, ctx, false);
  y -= 6;
  page.drawText(ascii(clientName), { x: MARGIN, y, size: 14, font: bold, color: INK });
  y -= 26;

  sectionTitle(page, ctx, y, "YOUR RISK CATEGORY");
  y -= 22;
  if (bands.length) {
    page.drawText(ascii(`Where you sit on the firm's ${bands.length}-band scale - most risk-tolerant at the top.`), {
      x: MARGIN,
      y,
      size: 9,
      font: helv,
      color: MUTED,
    });
    y -= 18;

    const rowH = 34;
    for (const b of [...bands].reverse()) {
      ensure(rowH + 6);
      const top = y;
      page.drawRectangle({
        x: MARGIN,
        y: top - rowH,
        width: CONTENT_W,
        height: rowH,
        color: b.isCurrent ? blend(b.tone, 0.12) : PAPER,
        borderColor: b.isCurrent ? b.tone : LINE,
        borderWidth: b.isCurrent ? 1.4 : 0.8,
      });
      page.drawCircle({ x: MARGIN + 18, y: top - rowH / 2, size: 6, color: b.tone });
      page.drawText(ascii(b.label), {
        x: MARGIN + 34,
        y: top - rowH / 2 - 4,
        size: 11,
        font: bold,
        color: b.isCurrent ? INK : SLATE,
      });
      const range = ascii(`Score ${b.minScore} - ${b.maxScore}`);
      const rw = helv.widthOfTextAtSize(range, 9);
      page.drawText(range, { x: W - MARGIN - 14 - rw, y: top - rowH / 2 - 3.5, size: 9, font: helv, color: MUTED });
      if (b.isCurrent) {
        const pill = scoreText ? `YOUR PROFILE  -  ${scoreText}` : "YOUR PROFILE";
        const pw = bold.widthOfTextAtSize(pill, 7.5) + 18;
        const px = W - MARGIN - 14 - rw - 16 - pw;
        page.drawRectangle({ x: px, y: top - rowH / 2 - 8, width: pw, height: 16, color: b.tone });
        page.drawText(pill, { x: px + 9, y: top - rowH / 2 - 2.5, size: 7.5, font: bold, color: WHITE });
      }
      y -= rowH + 6;
    }
  } else {
    // No template bands available — fall back to a single result card.
    page.drawRectangle({
      x: MARGIN,
      y: y - 60,
      width: CONTENT_W,
      height: 60,
      color: blend(tone, 0.1),
      borderColor: tone,
      borderWidth: 1.2,
    });
    page.drawText(ascii(bandLabel), { x: MARGIN + 16, y: y - 36, size: 18, font: bold, color: tone });
    if (scoreText) {
      const st = `Score ${scoreText}`;
      page.drawText(st, { x: W - MARGIN - 16 - bold.widthOfTextAtSize(st, 11), y: y - 36, size: 11, font: bold, color: INK });
    }
    y -= 72;
  }

  // What this means
  y -= 12;
  const meaning =
    blurb ||
    "Your responses place you in this category. Your distributor will use it, together with your goals and investment horizon, to recommend suitable schemes.";
  const meaningLines = wrap(ascii(meaning), helv, 10, CONTENT_W);
  ensure(20 + meaningLines.length * 14);
  sectionTitle(page, ctx, y, "WHAT THIS MEANS");
  y -= 20;
  for (const ln of meaningLines) {
    page.drawText(ln, { x: MARGIN, y, size: 10, font: helv, color: SLATE });
    y -= 14;
  }

  // Indicative asset allocation
  if (allocation) {
    y -= 16;
    ensure(150);
    sectionTitle(page, ctx, y, `INDICATIVE ASSET ALLOCATION - ${bandLabel.toUpperCase()}`);
    y -= 24;
    const barH = 22;
    const total = ALLOCATION_ORDER.reduce((s, a) => s + (allocation[a.key] ?? 0), 0) || 100;
    let bx = MARGIN;
    for (const a of ALLOCATION_ORDER) {
      const pct = allocation[a.key] ?? 0;
      if (pct <= 0) continue;
      const bw = (pct / total) * CONTENT_W;
      page.drawRectangle({ x: bx, y: y - barH, width: bw, height: barH, color: a.color });
      const lbl = `${pct}%`;
      const lw = bold.widthOfTextAtSize(lbl, 8.5);
      if (bw > lw + 10) {
        page.drawText(lbl, { x: bx + bw / 2 - lw / 2, y: y - barH / 2 - 3, size: 8.5, font: bold, color: WHITE });
      }
      bx += bw;
    }
    y -= barH + 18;
    const legendW = CONTENT_W / ALLOCATION_ORDER.length;
    ALLOCATION_ORDER.forEach((a, i) => {
      const lx = MARGIN + i * legendW;
      page.drawRectangle({ x: lx, y: y - 2, width: 9, height: 9, color: a.color });
      page.drawText(`${allocation[a.key] ?? 0}%`, { x: lx + 14, y: y - 1, size: 12, font: bold, color: INK });
      page.drawText(ascii(a.label), { x: lx + 14, y: y - 13, size: 7.5, font: helv, color: MUTED });
    });
    y -= 34;
    const note =
      "Indicative only. The final allocation is agreed with your distributor and depends on your goals, time horizon, liquidity needs and existing holdings. Past performance is not indicative of future returns.";
    for (const ln of wrap(ascii(note), helv, 8, CONTENT_W)) {
      page.drawText(ln, { x: MARGIN, y, size: 8, font: helv, color: MUTED });
      y -= 10.5;
    }
  }

  // Profile details
  y -= 18;
  ensure(20 + 7 * 17);
  sectionTitle(page, ctx, y, "PROFILE DETAILS");
  y -= 20;
  const details: Array<[string, string]> = [
    ["Profiled on", fmtDate(profile.profileDate ?? null)],
    ["Age at profiling", profile.age != null ? String(profile.age) : "-"],
    ["Signed by", profile.signedByName ?? (profile.signedAt ? clientName : "Not yet signed")],
    ["Signed on", profile.signedAt ? fmtDateTime(profile.signedAt) : "-"],
    ["Verification", profile.verificationMethod ? verificationLabel(profile.verificationMethod) : "-"],
    ["Next review due", fmtDate(profile.nextReviewAt ?? null)],
    ["Reference", ctx.refId ? String(ctx.refId).slice(0, 8).toUpperCase() : "-"],
  ];
  const drow = 17;
  details.forEach(([k, v], i) => {
    const top = y - i * drow;
    if (i % 2 === 0) page.drawRectangle({ x: MARGIN, y: top - drow + 4, width: CONTENT_W, height: drow, color: PAPER });
    page.drawText(ascii(k), { x: MARGIN + 10, y: top - 8, size: 9, font: helv, color: MUTED });
    page.drawText(ascii(v), { x: MARGIN + 150, y: top - 8, size: 9, font: bold, color: INK });
  });
  y -= details.length * drow;
  drawFooter(page, ctx);

  // ═══════════════════════ 3. QUESTIONNAIRE ═════════════════════════════
  page = doc.addPage([W, H]);
  y = drawHeader(page, ctx, false);

  y -= 6;
  page.drawText(ascii(clientName), { x: MARGIN, y, size: 14, font: bold, color: INK });
  y -= 26;
  sectionTitle(page, ctx, y, "RISK PROFILE QUESTIONNAIRE");
  y -= 20;
  const items = Array.isArray(profile.responses) ? profile.responses : [];
  page.drawText(ascii(`${items.length} question${items.length === 1 ? "" : "s"}  -  the option you chose is highlighted`), {
    x: MARGIN,
    y,
    size: 9,
    font: helv,
    color: MUTED,
  });
  y -= 22;

  if (items.length === 0) {
    page.drawText("No questionnaire responses recorded.", { x: MARGIN, y, size: 9.5, font: helv, color: MUTED });
    y -= 16;
  }

  const byKey = new Map<string, RiskPdfQuestion>();
  for (const q of profile.questions ?? []) byKey.set(q.key, q);

  const optSize = 9.5;
  const optLineH = 12;
  const optPad = 6;
  let idx = 1;
  for (const r of items) {
    const tq = r.key ? byKey.get(r.key) : undefined;
    const chosenLabel = (r.answer ?? "").trim();
    // Prefer the template's full option list; if the template no longer has this
    // question (or its options changed), fall back to the recorded answer alone.
    let options: Array<{ label: string; score: number | null; chosen: boolean }> =
      tq && tq.options.some((o) => o.label.trim() === chosenLabel)
        ? tq.options.map((o) => ({ label: o.label, score: o.score, chosen: o.label.trim() === chosenLabel }))
        : [{ label: chosenLabel || "-", score: r.score ?? null, chosen: true }];
    if (!options.some((o) => o.chosen) && options.length) options = options.map((o, i) => ({ ...o, chosen: i === 0 }));

    const qLines = wrap(ascii((tq?.label ?? r.question ?? "-").trim()), bold, 10, CONTENT_W - 30);
    const optLines = options.map((o) => wrap(ascii(o.label), o.chosen ? bold : helv, optSize, CONTENT_W - 100));
    const blockH = qLines.length * 14 + optLines.reduce((s, ls) => s + ls.length * optLineH + optPad, 0) + 24;
    ensure(blockH);

    // Question number badge + text
    const num = String(idx);
    page.drawCircle({ x: MARGIN + 8, y: y + 3, size: 8, color: primary });
    page.drawText(num, { x: MARGIN + 8 - bold.widthOfTextAtSize(num, 7.5) / 2, y: y + 0.5, size: 7.5, font: bold, color: WHITE });
    for (const ln of qLines) {
      page.drawText(ln, { x: MARGIN + 24, y, size: 10, font: bold, color: INK });
      y -= 12;
    }
    y -= 2;

    options.forEach((o, oi) => {
      const lines = optLines[oi];
      const rowH = lines.length * optLineH + optPad;
      const top = y + 4;
      if (o.chosen) {
        page.drawRectangle({
          x: MARGIN + 16,
          y: top - rowH,
          width: CONTENT_W - 16,
          height: rowH,
          color: blend(tone, 0.12),
          borderColor: blend(tone, 0.45),
          borderWidth: 0.8,
        });
      }
      const cy = top - optPad - 1.5;
      if (o.chosen) {
        page.drawCircle({ x: MARGIN + 30, y: cy, size: 4.6, color: tone });
        page.drawCircle({ x: MARGIN + 30, y: cy, size: 1.8, color: WHITE });
      } else {
        page.drawCircle({ x: MARGIN + 30, y: cy, size: 4.2, borderColor: MUTED, borderWidth: 0.9 });
      }
      let ty = top - optPad - 5;
      lines.forEach((ln, li) => {
        page.drawText(ln, {
          x: MARGIN + 42,
          y: ty,
          size: optSize,
          font: o.chosen ? bold : helv,
          color: o.chosen ? INK : SLATE,
        });
        if (li === 0 && o.chosen && o.score != null) {
          const st = o.score >= 0 ? `+${o.score}` : String(o.score);
          const sw = bold.widthOfTextAtSize(st, 9);
          page.drawText(st, { x: W - MARGIN - 12 - sw, y: ty, size: 9, font: bold, color: tone });
        }
        ty -= optLineH;
      });
      y -= rowH;
    });

    y -= 6;
    page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: 0.6, color: LINE });
    y -= 12;
    idx++;
  }

  // ═══════════════════════ 4. DECLARATION ═══════════════════════════════
  let sigImg: PDFImage | null = null;
  if (profile.signatureImage?.bytes?.length) {
    try {
      sigImg = /png/i.test(profile.signatureImage.mime)
        ? await doc.embedPng(profile.signatureImage.bytes)
        : await doc.embedJpg(profile.signatureImage.bytes);
    } catch {
      sigImg = null;
    }
  }
  const declLines = wrap(ascii(DECLARATION), helv, 9, CONTENT_W - 24);
  const disclosure = ascii(
    `Disclosure: ${firm} is an AMFI-registered mutual fund distributor${arnNo ? ` (ARN-${arnNo})` : ""} and receives ` +
      `distribution commission from asset management companies for the schemes it distributes. This report records the ` +
      `client's risk appetite for product-suitability purposes and does not constitute investment advice.`
  );
  const discLines = wrap(disclosure, helv, 7.5, CONTENT_W);
  const sigImgH = sigImg ? 48 : 0;
  ensure(16 + declLines.length * 12 + 16 + 20 + discLines.length * 10 + 26 + 28 + sigImgH);
  sectionTitle(page, ctx, y, "DECLARATION");
  y -= 20;
  page.drawRectangle({
    x: MARGIN,
    y: y - declLines.length * 12 - 4,
    width: CONTENT_W,
    height: declLines.length * 12 + 16,
    color: PAPER,
    borderColor: LINE,
    borderWidth: 1,
  });
  let dy = y;
  for (const ln of declLines) {
    page.drawText(ln, { x: MARGIN + 12, y: dy, size: 9, font: helv, color: SLATE });
    dy -= 12;
  }
  y = dy - 20;
  for (const ln of discLines) {
    page.drawText(ln, { x: MARGIN, y, size: 7.5, font: helv, color: MUTED });
    y -= 10;
  }
  y -= 26 + sigImgH;

  // Signature row — client (left, with the uploaded signature when we have one) and firm (right)
  if (sigImg) {
    const maxW = COL_W - 24;
    const maxH = 44;
    const k = Math.min(maxW / sigImg.width, maxH / sigImg.height);
    page.drawImage(sigImg, { x: LEFT_X + 6, y: y + 6, width: sigImg.width * k, height: sigImg.height * k });
  }
  page.drawRectangle({ x: LEFT_X, y, width: COL_W, height: 0.8, color: SLATE });
  page.drawRectangle({ x: RIGHT_X, y, width: COL_W, height: 0.8, color: SLATE });
  y -= 12;
  page.drawText(ascii(profile.signedByName ?? clientName), { x: LEFT_X, y, size: 9.5, font: bold, color: INK });
  page.drawText(ascii(`For ${firm}`), { x: RIGHT_X, y, size: 9.5, font: bold, color: INK });
  y -= 12;
  const sigMeta = profile.signedAt
    ? `Signed ${fmtDateTime(profile.signedAt)}${profile.verificationMethod ? `  -  ${verificationLabel(profile.verificationMethod)}` : ""}`
    : "Client signature pending";
  page.drawText(ascii(sigMeta), { x: LEFT_X, y, size: 8, font: helv, color: MUTED });
  page.drawText("Authorised Signatory", { x: RIGHT_X, y, size: 8, font: helv, color: MUTED });

  drawFooter(page, ctx);
  drawPageNumbers(doc, helv, W, 8);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/* ───────────────────────── layout helpers ───────────────────────── */

type Ctx = {
  helv: PDFFont;
  bold: PDFFont;
  primary: RGB;
  logo: PDFImage | null;
  brand: RiskProfileBrand;
  generatedAt: string;
  preparedOn: string;
  refId?: string | null;
};

function sectionTitle(page: PDFPage, ctx: Ctx, y: number, title: string) {
  page.drawText(ascii(title), { x: MARGIN, y, size: 9, font: ctx.bold, color: ctx.primary });
  page.drawRectangle({ x: MARGIN, y: y - 8, width: CONTENT_W, height: 1, color: LINE });
}

/** Letterhead. `full` = cover (logo + ARN + gradient strip); else a slim
 *  continuation header. Returns the y to start body content at. */
function drawHeader(page: PDFPage, ctx: Ctx, full: boolean): number {
  const { helv, bold, primary, logo, brand } = ctx;

  if (!full) {
    return drawContinuationHeader({
      page,
      helv,
      bold,
      pageWidth: W,
      pageHeight: H,
      margin: MARGIN,
      firmName: brand.legalName ?? brand.displayName,
      title: "Risk profile report",
      primary,
    });
  }

  const secondary = brand.secondaryColor ? hexToRgb(brand.secondaryColor) : primary;
  return drawReportHeader({
    page,
    helv,
    bold,
    pageWidth: W,
    pageHeight: H,
    margin: MARGIN,
    logo,
    firmName: brand.legalName ?? brand.displayName,
    title: "RISK PROFILE REPORT",
    subtitles: [ctx.refId ? `Ref ${String(ctx.refId).slice(0, 8).toUpperCase()}` : null],
    arn: brand.arn,
    primary,
    secondary,
  });
}

function drawFooter(page: PDFPage, ctx: Ctx) {
  const { helv, bold, brand } = ctx;
  page.drawRectangle({ x: MARGIN, y: 52, width: W - 2 * MARGIN, height: 1, color: LINE });
  const legal = ascii(brand.legalName ?? brand.displayName ?? "Your Advisor");
  // Only show the ARN when the firm actually has one — otherwise it printed an
  // ugly "ARN--" placeholder for firms with no ARN on record.
  const arnNo = brand.arn ? String(brand.arn).replace(/^ARN[-\s]*/i, "") : "";
  page.drawText(ascii(arnNo ? `${legal}  -  ARN-${arnNo}` : legal), { x: MARGIN, y: 40, size: 8, font: bold, color: SLATE });
  const gen = ascii(
    `Generated ${fmtDateTime(ctx.generatedAt)}${ctx.refId ? ` - Ref ${String(ctx.refId).slice(0, 8).toUpperCase()}` : ""}`
  );
  const gw = helv.widthOfTextAtSize(gen, 7.5);
  page.drawText(gen, { x: W - MARGIN - gw, y: 40, size: 7.5, font: helv, color: MUTED });
  let dy = 26;
  for (const line of wrap(DISCLAIMER, helv, 7, W - 2 * MARGIN).slice(0, 2)) {
    page.drawText(line, { x: MARGIN, y: dy, size: 7, font: helv, color: MUTED });
    dy -= 9;
  }
}

/* ───────────────────────── domain helpers ───────────────────────── */

/** Band's own allocation → canonical-id preset → position-on-ladder preset. */
function resolveAllocation(current: ResolvedBand | null, bands: ResolvedBand[]): Required<RiskAllocation> | null {
  if (!current) return null;
  const own = current.allocation;
  if (own && Object.values(own).some((v) => typeof v === "number" && v > 0)) {
    return {
      equity: own.equity ?? 0,
      debt: own.debt ?? 0,
      cash: own.cash ?? 0,
      commodities: own.commodities ?? 0,
      alternatives: own.alternatives ?? 0,
    };
  }
  const byId = ALLOCATION_PRESETS.find((p) => p.ids.includes(current.id.toLowerCase()));
  if (byId) return byId.alloc;
  const i = bands.findIndex((b) => b.id === current.id);
  if (i < 0 || bands.length < 2) return ALLOCATION_PRESETS[2].alloc;
  const t = i / (bands.length - 1);
  return ALLOCATION_PRESETS[Math.round(t * (ALLOCATION_PRESETS.length - 1))].alloc;
}

function addressLines(a?: PostalAddress | null): string[] {
  if (!a) return [];
  const lines: string[] = [];
  if (a.line1?.trim()) lines.push(a.line1.trim());
  if (a.line2?.trim()) lines.push(a.line2.trim());
  const cityState = [a.city?.trim(), a.state?.trim()].filter(Boolean).join(", ");
  const cityLine = `${cityState}${a.pincode?.trim() ? `${cityState ? " - " : ""}${a.pincode.trim()}` : ""}`;
  if (cityLine.trim()) lines.push(cityLine);
  if (a.country?.trim() && !/^india$/i.test(a.country.trim())) lines.push(a.country.trim());
  return lines;
}

function verificationLabel(method: string): string {
  const m = method.toLowerCase();
  switch (m) {
    case "client_otp":
      return "Email OTP verified";
    case "client_physical":
      return "Signed form uploaded";
    case "client_link":
      return "Secure link (self-submitted)";
    case "rm_entry":
      return "Recorded by RM";
  }
  if (m.includes("otp") && m.includes("email")) return "Email OTP";
  if (m.includes("otp")) return "OTP";
  if (m.includes("signature") || m.includes("upload")) return "Uploaded signature";
  if (m.includes("person") || m.includes("wet")) return "In person";
  if (m.includes("rm") || m.includes("advisor") || m.includes("staff")) return "Recorded by RM";
  return titleCase(method);
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

/** Mix a colour towards white — `a` is how much of the colour survives. */
function blend(c: RGB, a: number): RGB {
  return rgb(1 - (1 - c.red) * a, 1 - (1 - c.green) * a, 1 - (1 - c.blue) * a);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
/** Largest font size (stepping down by 0.5 to `min`) at which `text` fits in `maxW`. */
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
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
function ascii(s: string): string {
  if (!s) return "";
  // Keeps "₹" when the Unicode font is embedded; strips/converts otherwise.
  return pdfSanitize(s.replace(/·/g, "-"), KEEP_RUPEE);
}
function hexToRgb(hex: string | null | undefined): RGB {
  return hexToRgbOr(hex, DEFAULT_PRIMARY);
}
function hexToRgbOr(hex: string | null | undefined, fallback: RGB): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return fallback;
  const parts = m[1].match(/.{2}/g)!;
  const [r, g, b] = parts.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
