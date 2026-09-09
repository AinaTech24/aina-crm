/**
 * Risk Assessment Report (PDF).
 *
 * Layout follows the reference the firm supplied: a brand-coloured masthead and
 * footer on every page, a gauge showing where the client's score sits, their
 * investment goals, then the full questionnaire with EVERY option and its
 * points (the chosen one highlighted), and finally the scoring ladder, the
 * headline figures, the adviser's sign-off and the regulatory disclaimer.
 *
 * Why every option is printed rather than just the answer: the score only means
 * something next to the alternatives the client passed over, and a suitability
 * file that cannot show the question as it was asked is hard to defend on review.
 *
 * Helvetica is WinAnsi-only, so all dynamic text passes through ascii()
 * (₹ → "Rs ", smart quotes/dashes normalised) before drawing.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
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
export type RiskProfileBrand = StatementBrand & {
  address?: PostalAddress | null;
  /** Extra registration lines under the sign-off, e.g. "APMI Registered PMS Distributor | APRN04012". */
  registrationLines?: string[] | null;
};

export type RiskPdfBand = {
  id: string;
  label: string;
  minScore: number;
  maxScore: number;
  color?: string | null;
  description?: string | null;
  allocation?: RiskAllocation | null;
  /** Indicative holding period for this band, e.g. "7-10 years". */
  horizon?: string | null;
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
  /** Template's maximum possible score — gives the score context ("34 / 53"). */
  maxScore?: number | null;
  profileDate?: string | null; // yyyy-mm-dd
  signedAt?: string | null; // ISO
  signedByName?: string | null;
  nextReviewAt?: string | null; // yyyy-mm-dd
  age?: number | null;
  verificationMethod?: string | null;
  /** Per-question breakdown, as stored in risk_profile_responses.responses. */
  responses: Array<{ key?: string; question?: string; answer?: string; score?: number | null }>;
  /** The firm's template bands — drives the gauge and the scoring ladder. */
  bands?: RiskPdfBand[] | null;
  /** The firm's template questions — lets the report list every option. */
  questions?: RiskPdfQuestion[] | null;
  /** Optional template description (admin-facing; not printed). */
  templateDescription?: string | null;
  /** Client's uploaded signature / signed form, when it is a PNG or JPEG. */
  signatureImage?: { bytes: Uint8Array; mime: string } | null;
  /** The client's goals, shown as chips. */
  investmentGoals?: string[] | null;
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
  /** Audit reference (response row id) — printed as the Profile ID. */
  refId?: string | null;
  /** Who signs the report off. Falls back to the firm name. */
  adviserName?: string | null;
};

const INK: RGB = rgb(0.09, 0.13, 0.19);
const SLATE: RGB = rgb(0.29, 0.35, 0.42);
const MUTED: RGB = rgb(0.55, 0.61, 0.68);
const LINE: RGB = rgb(0.87, 0.89, 0.92);
const WHITE: RGB = rgb(1, 1, 1);
const PAPER: RGB = rgb(0.976, 0.98, 0.985);
const DEFAULT_PRIMARY: RGB = rgb(0.9, 0.32, 0.06);

const W = 595.28;
const H = 841.89; // A4
const MARGIN = 46;
const CONTENT_W = W - 2 * MARGIN;
const HEADER_H = 78;
const FOOTER_H = 26;
/** Body content must stay above this. */
const BODY_FLOOR = FOOTER_H + 20;

// Glyph switch — set per render from the embedded font (process-stable).
let KEEP_RUPEE = false;

/**
 * Anchor for every drawSvgPath call.
 *
 * pdf-lib positions an SVG path at {x, y} in NATIVE pdf coordinates and then
 * treats the path's own y as growing DOWNWARD. With no anchor it defaults to
 * (0, 0) — the page's BOTTOM-left — so a top-left-relative path is drawn far
 * below the page and silently renders nothing. Anchoring at the top-left makes
 * `H - y` the correct flip.
 */
const SVG_ANCHOR = { x: 0, y: H } as const;

/** Fallback gauge/ladder colours when a band carries none, low risk → high. */
const BAND_FALLBACK = ["#2563eb", "#0d9488", "#16a34a", "#ea580c", "#dc2626", "#7c2d12"];

const DISCLAIMER_PARAGRAPHS = [
  "Mutual Fund investments are subject to market risks. Investors are advised to read all scheme-related documents carefully before investing. Past performance may or may not be sustained in the future, and no assurance or guarantee is given regarding returns or capital protection. Dividend or income distributions, where applicable, are not assured and depend on scheme surplus; applicable taxes, including TDS, may be deducted in accordance with prevailing regulations.",
  "Lock-in periods, exit loads and taxation vary depending on scheme category, investment mode (lumpsum / SIP / STP / SWP) and holding period. ELSS schemes typically carry a three-year lock-in for lumpsum investments, with SIP instalments treated independently. Short-term and long-term capital-gains taxation applies as per prevailing laws, which are subject to change. Investors are encouraged to consult their tax advisors before executing any purchase, switch, redemption, STP or SWP transaction.",
  "This risk profile is based on the responses recorded above, which are self-declared by the client. It is used to assess the suitability of schemes before they are recommended, and should be reviewed at least annually and whenever the client's circumstances, goals or investment horizon change.",
  "Clients are requested to promptly notify us of any change in personal particulars such as address, contact information, bank mandates, nominee details or joint-holder information, to ensure uninterrupted servicing and regulatory compliance.",
];

type ResolvedBand = RiskPdfBand & { tone: RGB; isCurrent: boolean };

type Ctx = {
  helv: PDFFont;
  bold: PDFFont;
  primary: RGB;
  brand: RiskProfileBrand;
  refId: string | null;
  generatedAt: string;
  firmName: string;
};

export async function renderRiskProfilePdf(args: RenderRiskProfileArgs): Promise<Buffer> {
  const { profile, investor, brand } = args;
  const doc = await PDFDocument.create();
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  KEEP_RUPEE = rupeeOk;

  const primary = hexToRgb(brand.primaryColor);
  const clientName = investor.name ?? "Client";
  const firmName = brand.legalName ?? brand.displayName ?? "Your Advisor";
  const profileId = args.refId ? `RP-${String(args.refId).replace(/-/g, "").slice(0, 6).toUpperCase()}` : "";

  doc.setTitle(ascii(`Risk Assessment Report - ${clientName}`));
  doc.setProducer("Aina CRM");
  doc.setAuthor(ascii(firmName));
  if (profileId) doc.setSubject(profileId);

  const ctx: Ctx = {
    helv,
    bold,
    primary,
    brand,
    refId: profileId || null,
    generatedAt: args.generatedAt,
    firmName,
  };

  // ── Resolve the band ladder + the client's position on it ────────────────
  const rawBands = (profile.bands ?? []).slice().sort((a, b) => a.minScore - b.minScore);
  const score = profile.totalScore;
  const bands: ResolvedBand[] = rawBands.map((b, i) => ({
    ...b,
    tone: hexToRgbOr(b.color, hexToRgb(BAND_FALLBACK[Math.min(i, BAND_FALLBACK.length - 1)])),
    isCurrent:
      score != null
        ? score >= b.minScore && score <= b.maxScore
        : String(b.id) === String(profile.category ?? ""),
  }));
  // Never leave the ladder without a current band when we know the category.
  if (bands.length && !bands.some((b) => b.isCurrent) && profile.category) {
    const byId = bands.findIndex((b) => String(b.id) === String(profile.category));
    if (byId >= 0) bands[byId].isCurrent = true;
  }
  const current = bands.find((b) => b.isCurrent) ?? null;
  const bandLabel = current?.label ?? (profile.category ? titleCase(profile.category) : "Not categorised");
  const scoreMax =
    profile.maxScore ?? (bands.length ? Math.max(...bands.map((b) => b.maxScore)) : null);
  const scoreText = score != null ? (scoreMax ? `${score} / ${scoreMax}` : String(score)) : "-";

  // ── Page machinery ───────────────────────────────────────────────────────
  let page = doc.addPage([W, H]);
  let y = drawMasthead(page, ctx);

  const newPage = () => {
    drawFooterBar(page, ctx);
    page = doc.addPage([W, H]);
    y = HEADER_H + 8; // continuation pages carry the bar, not the full masthead
    drawSlimHeader(page, ctx);
    y = H - 46;
  };
  const ensure = (need: number) => {
    if (y - need < BODY_FLOOR) newPage();
  };

  // ── Title band ───────────────────────────────────────────────────────────
  const titleH = 52;
  page.drawRectangle({ x: 0, y: y - titleH, width: W, height: titleH, color: blend(primary, 0.07) });
  centerText(page, "Risk Assessment Report", y - 22, 15, bold, INK);
  centerText(page, ascii(`Assessment for: ${clientName}`), y - 40, 12.5, bold, INK);
  y -= titleH + 18;

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
  const metaCells: Array<[string, string]> = [
    ["Profile ID", profileId || "-"],
    ["Date", fmtDateLong(profile.profileDate ?? args.generatedAt)],
    ["Valid Until", profile.nextReviewAt ? fmtDateLong(profile.nextReviewAt) : "-"],
  ];
  metaCells.forEach(([k, v], i) => {
    const x = MARGIN + 14 + i * (CONTENT_W / 3);
    page.drawText(ascii(`${k}: ${v}`), { x, y: y - 19, size: 8.5, font: helv, color: SLATE });
  });
  y -= metaH + 26;

  // ── Risk assessment summary + gauge ──────────────────────────────────────
  y = sectionRule(page, ctx, y, "RISK ASSESSMENT SUMMARY");
  y -= 10;
  y = drawGauge(page, ctx, y, bands, current, score, scoreMax);
  centerText(page, ascii(bandLabel), y, 17, bold, current?.tone ?? primary);
  y -= 18;
  centerText(page, ascii(`Score ${scoreText}`), y, 10, helv, SLATE);
  y -= 24;

  // ── Investment goals ─────────────────────────────────────────────────────
  const goals = (profile.investmentGoals ?? []).filter((g) => String(g ?? "").trim()).slice(0, 8);
  if (goals.length) {
    y = sectionRule(page, ctx, y, "INVESTMENT GOALS");
    y -= 16;
    let cx = MARGIN;
    const chipH = 22;
    for (const g of goals) {
      const label = ascii(String(g).trim());
      const wdt = bold.widthOfTextAtSize(label, 9) + 22;
      if (cx + wdt > MARGIN + CONTENT_W) {
        cx = MARGIN;
        y -= chipH + 6;
        ensure(chipH + 10);
      }
      page.drawRectangle({
        x: cx,
        y: y - chipH,
        width: wdt,
        height: chipH,
        color: blend(primary, 0.07),
        borderColor: blend(primary, 0.35),
        borderWidth: 0.8,
      });
      page.drawText(label, { x: cx + 11, y: y - chipH + 7.5, size: 9, font: bold, color: primary });
      cx += wdt + 8;
    }
    y -= chipH + 22;
  }

  // ── Questionnaire ────────────────────────────────────────────────────────
  ensure(80);
  y = sectionRule(page, ctx, y, "QUESTIONNAIRE RESPONSES");
  y -= 18;

  const answered = new Map<string, string>();
  for (const r of profile.responses ?? []) {
    if (r?.key) answered.set(String(r.key), String(r.answer ?? "").trim());
    if (r?.question) answered.set(`q:${String(r.question).trim()}`, String(r.answer ?? "").trim());
  }

  const questions: RiskPdfQuestion[] =
    profile.questions && profile.questions.length
      ? profile.questions
      : // No template on file (an older profile): fall back to just what was chosen.
        (profile.responses ?? []).map((r, i) => ({
          key: r.key ?? `q${i + 1}`,
          label: r.question ?? "-",
          options: [{ value: "chosen", label: r.answer ?? "-", score: r.score ?? 0 }],
        }));

  const OPT_SIZE = 9;
  const OPT_ROW = 19;

  questions.forEach((q, qi) => {
    const chosen = answered.get(q.key) ?? answered.get(`q:${String(q.label).trim()}`) ?? "";
    const numLabel = `Q${qi + 1}.`;
    const numW = bold.widthOfTextAtSize(numLabel, 9.5) + 4;
    const qLines = wrap(ascii(q.label), helv, 9.5, CONTENT_W - numW - 8);

    ensure(qLines.length * 13 + q.options.length * OPT_ROW + 22);

    page.drawText(numLabel, { x: MARGIN, y, size: 9.5, font: bold, color: primary });
    qLines.forEach((ln, li) => {
      page.drawText(ln, { x: MARGIN + numW, y: y - li * 13, size: 9.5, font: helv, color: INK });
    });
    y -= qLines.length * 13 + 6;

    for (const o of q.options) {
      ensure(OPT_ROW + 6);
      const isChosen = chosen !== "" && o.label.trim() === chosen;
      const rowTop = y + 5;

      if (isChosen) {
        page.drawRectangle({
          x: MARGIN,
          y: rowTop - OPT_ROW,
          width: CONTENT_W,
          height: OPT_ROW,
          color: blend(primary, 0.09),
        });
      }

      const cy = rowTop - OPT_ROW / 2;
      if (isChosen) {
        page.drawCircle({ x: MARGIN + 18, y: cy, size: 5.4, color: primary });
        // A tick, drawn as two strokes — a glyph would depend on the font.
        page.drawLine({
          start: { x: MARGIN + 15.6, y: cy + 0.2 },
          end: { x: MARGIN + 17.4, y: cy - 2 },
          thickness: 1.4,
          color: WHITE,
        });
        page.drawLine({
          start: { x: MARGIN + 17.4, y: cy - 2 },
          end: { x: MARGIN + 20.6, y: cy + 2.6 },
          thickness: 1.4,
          color: WHITE,
        });
      } else {
        page.drawCircle({ x: MARGIN + 18, y: cy, size: 5.2, borderColor: rgb(0.78, 0.82, 0.86), borderWidth: 1 });
      }

      const label = ascii(o.label);
      const labelFont = isChosen ? bold : helv;
      const maxLabelW = CONTENT_W - 62;
      const shown = truncate(label, labelFont, OPT_SIZE, maxLabelW);
      page.drawText(shown, {
        x: MARGIN + 32,
        y: cy - 3,
        size: OPT_SIZE,
        font: labelFont,
        color: isChosen ? INK : SLATE,
      });

      const st = String(o.score);
      const sw = (isChosen ? bold : helv).widthOfTextAtSize(st, OPT_SIZE);
      page.drawText(st, {
        x: MARGIN + CONTENT_W - 14 - sw,
        y: cy - 3,
        size: OPT_SIZE,
        font: isChosen ? bold : helv,
        color: isChosen ? primary : MUTED,
      });

      y -= OPT_ROW;
    }
    y -= 12;
  });

  // ── Scoring & risk category ──────────────────────────────────────────────
  const explain =
    `Your risk score is the total of the points from each questionnaire answer (shown at the right of every option). ` +
    `A higher total reflects a higher capacity for risk.` +
    (score != null ? ` Your total of ${scoreText} places you in the ${bandLabel} band shown below:` : "");
  const explainLines = wrap(ascii(explain), helv, 9, CONTENT_W);
  ensure(30 + explainLines.length * 12 + 150);

  y = sectionRule(page, ctx, y, "SCORING & RISK CATEGORY");
  y -= 16;
  for (const ln of explainLines) {
    page.drawText(ln, { x: MARGIN, y, size: 9, font: helv, color: SLATE });
    y -= 12;
  }
  y -= 12;

  if (bands.length) {
    y = drawBandLadder(page, ctx, y, bands);
    y -= 10;
    if (score != null) {
      const line = ascii(`Your category: ${bandLabel}  (total score ${scoreText})`);
      centerText(page, line, y, 9.5, bold, current?.tone ?? primary);
      y -= 22;
    }
  }

  // ── Headline figures ─────────────────────────────────────────────────────
  ensure(70);
  const stats: Array<[string, string, RGB]> = [
    ["TOTAL SCORE", scoreText, INK],
    ["RISK CATEGORY", bandLabel, current?.tone ?? primary],
    ["INVESTMENT HORIZON", current?.horizon?.trim() || horizonForBand(bands, current), INK],
    ["VALID UNTIL", profile.nextReviewAt ? fmtDateLong(profile.nextReviewAt) : "-", INK],
  ];
  const boxW = (CONTENT_W - 3 * 8) / 4;
  const boxH = 46;
  stats.forEach(([label, value, tone], i) => {
    const x = MARGIN + i * (boxW + 8);
    page.drawRectangle({
      x,
      y: y - boxH,
      width: boxW,
      height: boxH,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.8,
    });
    const lw = helv.widthOfTextAtSize(label, 6.5);
    page.drawText(label, { x: x + (boxW - lw) / 2, y: y - 17, size: 6.5, font: helv, color: MUTED });
    const v = ascii(value);
    const vs = fitSize(v, bold, boxW - 12, 11, 7);
    const vw = bold.widthOfTextAtSize(v, vs);
    page.drawText(v, { x: x + (boxW - vw) / 2, y: y - 33, size: vs, font: bold, color: tone });
  });
  y -= boxH + 30;

  // ── Sign-off ─────────────────────────────────────────────────────────────
  const regLines = [
    [
      brand.arn ? `AMFI Registered Mutual Fund Distributor | ARN-${String(brand.arn).replace(/^ARN[-\s]*/i, "")}` : "AMFI Registered Mutual Fund Distributor",
    ].join(""),
    brand.euin ? `EUIN ${brand.euin}` : "",
    ...(brand.registrationLines ?? []),
  ].filter(Boolean) as string[];

  const signerName = args.adviserName?.trim() || profile.signedByName?.trim() || firmName;
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
  const sigImgH = sigImg ? 42 : 0;
  ensure(40 + sigImgH + regLines.length * 14 + 40);

  page.drawText("Warm Regards,", { x: MARGIN, y, size: 11, font: helv, color: SLATE });
  const dateStr = ascii(fmtDateLong(profile.profileDate ?? args.generatedAt));
  const dw = helv.widthOfTextAtSize(dateStr, 11);
  page.drawText(dateStr, { x: MARGIN + CONTENT_W - dw, y, size: 11, font: helv, color: SLATE });
  y -= sigImg ? 8 : 22;

  if (sigImg) {
    const maxW = 190;
    const k = Math.min(maxW / sigImg.width, sigImgH / sigImg.height);
    page.drawImage(sigImg, { x: MARGIN, y: y - sigImgH, width: sigImg.width * k, height: sigImg.height * k });
    y -= sigImgH + 8;
  }

  const nameSize = fitSize(ascii(signerName), bold, CONTENT_W, 16, 12);
  page.drawText(ascii(signerName), { x: MARGIN, y, size: nameSize, font: bold, color: INK });
  y -= 20;
  page.drawText(ascii(firmName), { x: MARGIN, y, size: 11, font: helv, color: SLATE });
  y -= 14;
  page.drawRectangle({ x: MARGIN, y, width: CONTENT_W * 0.55, height: 0.8, color: LINE });
  y -= 16;
  for (const ln of regLines) {
    page.drawText(ascii(ln), { x: MARGIN, y, size: 10, font: helv, color: SLATE });
    y -= 14;
  }
  y -= 12;

  // ── Disclaimer ───────────────────────────────────────────────────────────
  const discBlocks = DISCLAIMER_PARAGRAPHS.map((p) => wrap(ascii(p), helv, 7.2, CONTENT_W));
  ensure(26 + discBlocks.reduce((s, b) => s + b.length * 9 + 7, 0));

  page.drawText("DISCLAIMER", { x: MARGIN, y, size: 9, font: bold, color: primary });
  y -= 5;
  page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_W, height: 1.2, color: primary });
  y -= 14;
  for (const blockLines of discBlocks) {
    ensure(blockLines.length * 9 + 8);
    for (const ln of blockLines) {
      page.drawText(ln, { x: MARGIN, y, size: 7.2, font: helv, color: MUTED });
      y -= 9;
    }
    y -= 7;
  }

  drawFooterBar(page, ctx);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/* ───────────────────────── page furniture ───────────────────────── */

/** Full masthead: firm name + tagline on the brand bar, ref + date on the right. */
function drawMasthead(page: PDFPage, ctx: Ctx): number {
  const { helv, bold, primary, brand } = ctx;
  page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: primary });

  const nameSize = fitSize(ascii(ctx.firmName), bold, CONTENT_W - 150, 19, 13);
  page.drawText(ascii(ctx.firmName), {
    x: MARGIN,
    y: H - 38,
    size: nameSize,
    font: bold,
    color: WHITE,
  });

  const tagline = brand.arn
    ? "AMFI Registered Mutual Fund Distributor"
    : "Mutual Fund Distributor";
  page.drawText(ascii(tagline), { x: MARGIN, y: H - 57, size: 10, font: bold, color: blend(WHITE, 0.85) });

  const right: string[] = [ctx.refId ?? "", fmtDateLong(ctx.generatedAt)].filter(Boolean);
  right.forEach((t, i) => {
    const s = ascii(t);
    const tw = helv.widthOfTextAtSize(s, 9.5);
    page.drawText(s, {
      x: W - MARGIN - tw,
      y: H - 34 - i * 15,
      size: 9.5,
      font: helv,
      color: blend(WHITE, 0.9),
    });
  });

  return H - HEADER_H;
}

/** Slim brand bar for continuation pages. */
function drawSlimHeader(page: PDFPage, ctx: Ctx) {
  const { bold, helv, primary } = ctx;
  const h = 30;
  page.drawRectangle({ x: 0, y: H - h, width: W, height: h, color: primary });
  const name = ascii(ctx.firmName);
  const size = fitSize(name, bold, CONTENT_W - 140, 11, 8);
  page.drawText(name, { x: MARGIN, y: H - 20, size, font: bold, color: WHITE });
  const r = ascii(ctx.refId ?? "");
  if (r) {
    const rw = helv.widthOfTextAtSize(r, 9);
    page.drawText(r, { x: W - MARGIN - rw, y: H - 20, size: 9, font: helv, color: blend(WHITE, 0.9) });
  }
}

function drawFooterBar(page: PDFPage, ctx: Ctx) {
  const { helv, primary } = ctx;
  page.drawRectangle({ x: 0, y: 0, width: W, height: FOOTER_H, color: primary });
  const site = (ctx.brand.website ?? "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const text = ascii(
    `This is a system generated document from ${ctx.firmName}${site ? `  |  ${site}` : ""}`
  );
  const size = fitSize(text, helv, CONTENT_W, 7.5, 6);
  const tw = helv.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (W - tw) / 2, y: 9.5, size, font: helv, color: blend(WHITE, 0.92) });
}

/** Centred small-caps section title with a rule either side. */
function sectionRule(page: PDFPage, ctx: Ctx, y: number, title: string): number {
  const { bold, primary } = ctx;
  const t = ascii(title);
  const size = 9;
  const tw = bold.widthOfTextAtSize(t, size);
  const gap = 12;
  const lineY = y - 3;
  const half = (CONTENT_W - tw - gap * 2) / 2;
  if (half > 8) {
    page.drawRectangle({ x: MARGIN, y: lineY, width: half, height: 0.8, color: blend(primary, 0.35) });
    page.drawRectangle({
      x: MARGIN + half + gap * 2 + tw,
      y: lineY,
      width: half,
      height: 0.8,
      color: blend(primary, 0.35),
    });
  }
  page.drawText(t, { x: MARGIN + half + gap, y, size, font: bold, color: INK });
  return y - 8;
}

/* ───────────────────────── the gauge ───────────────────────── */

/**
 * Semicircular gauge: one coloured arc segment per band, plus a needle at the
 * client's score. Drawn with SVG arc paths so the segments meet cleanly.
 * Returns the y below the graphic.
 */
function drawGauge(
  page: PDFPage,
  ctx: Ctx,
  yTop: number,
  bands: ResolvedBand[],
  current: ResolvedBand | null,
  score: number | null,
  maxScore: number | null
): number {
  const { helv, bold, primary } = ctx;
  const cx = W / 2;
  const R = 78;
  const thickness = 20;
  const cy = yTop - R - 6;

  const segs = bands.length ? bands : [{ tone: primary } as ResolvedBand];
  const lo = bands.length ? Math.min(...bands.map((b) => b.minScore)) : 0;
  const hi = bands.length ? Math.max(...bands.map((b) => b.maxScore)) : maxScore ?? 1;
  const span = Math.max(1, hi - lo);

  // Each band occupies a slice of the 180° sweep proportional to its width.
  let acc = 0;
  const gapDeg = 1.4;
  for (const b of segs) {
    const width = bands.length ? Math.max(0.0001, b.maxScore - b.minScore + 1) / (span + 1) : 1;
    const startDeg = 180 - acc * 180;
    const endDeg = 180 - (acc + width) * 180;
    drawArcBand(page, cx, cy, R, thickness, startDeg - gapDeg / 2, endDeg + gapDeg / 2, b.tone);
    acc += width;
  }

  // Needle — clamped into the sweep so an out-of-range score still points somewhere.
  if (score != null) {
    const frac = Math.min(1, Math.max(0, (score - lo) / span));
    const ang = ((180 - frac * 180) * Math.PI) / 180;
    const nx = cx + Math.cos(ang) * (R - thickness - 6);
    const ny = cy + Math.sin(ang) * (R - thickness - 6);
    page.drawLine({ start: { x: cx, y: cy }, end: { x: nx, y: ny }, thickness: 2.4, color: INK });
    page.drawCircle({ x: cx, y: cy, size: 5, color: INK });
  }

  // End labels, measured so they clear the arc ends rather than sitting on them.
  const endSize = 7.5;
  const cons = "Cons.";
  page.drawText(cons, {
    x: cx - R - 8 - bold.widthOfTextAtSize(cons, endSize),
    y: cy + 2,
    size: endSize,
    font: bold,
    color: segs[0]?.tone ?? SLATE,
  });
  page.drawText("Aggr.", {
    x: cx + R + 8,
    y: cy + 2,
    size: endSize,
    font: bold,
    color: segs[segs.length - 1]?.tone ?? SLATE,
  });
  if (bands.length > 2) {
    const mid = bands[Math.floor(bands.length / 2)];
    const t = ascii(mid.label);
    const size = 7.5;
    const tw = bold.widthOfTextAtSize(t, size);
    page.drawText(t, { x: cx - tw / 2, y: cy + R + 6, size, font: bold, color: mid.tone });
  }

  return cy - 18;
}

/**
 * One filled arc band between two angles (degrees, CCW from +x).
 *
 * Approximated as a polygon rather than an SVG "A" command: pdf-lib's path
 * parser handles M/L/Z but silently drew NOTHING for elliptical arcs, which is
 * why the gauge rendered as a bare needle. 28 steps is indistinguishable from a
 * true arc at this radius.
 */
function drawArcBand(
  page: PDFPage,
  cx: number,
  cy: number,
  rOuter: number,
  thickness: number,
  startDeg: number,
  endDeg: number,
  color: RGB
) {
  const rInner = rOuter - thickness;
  const a0 = (startDeg * Math.PI) / 180;
  const a1 = (endDeg * Math.PI) / 180;
  if (Math.abs(a1 - a0) < 0.002) return;

  // pdf-lib's SVG path origin is the page's top-left with y growing DOWN.
  const fy = (v: number) => H - v;
  const pt = (r: number, a: number) =>
    `${(cx + Math.cos(a) * r).toFixed(2)},${fy(cy + Math.sin(a) * r).toFixed(2)}`;

  const STEPS = 28;
  const parts: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const a = a0 + ((a1 - a0) * i) / STEPS;
    parts.push(`${i === 0 ? "M" : "L"} ${pt(rOuter, a)}`);
  }
  for (let i = STEPS; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / STEPS;
    parts.push(`L ${pt(rInner, a)}`);
  }
  parts.push("Z");
  page.drawSvgPath(parts.join(" "), { ...SVG_ANCHOR, color, borderWidth: 0 });
}

/* ───────────────────────── the band ladder ───────────────────────── */

/** Horizontal boxes, one per band, the client's highlighted with a pointer. */
function drawBandLadder(page: PDFPage, ctx: Ctx, yTop: number, bands: ResolvedBand[]): number {
  const { helv, bold } = ctx;
  const n = bands.length;
  const gap = 6;
  const boxW = (CONTENT_W - gap * (n - 1)) / n;
  const boxH = 46;

  bands.forEach((b, i) => {
    const x = MARGIN + i * (boxW + gap);
    const yBottom = yTop - boxH;
    page.drawRectangle({
      x,
      y: yBottom,
      width: boxW,
      height: boxH,
      color: b.isCurrent ? blend(b.tone, 0.1) : WHITE,
      borderColor: b.isCurrent ? b.tone : LINE,
      borderWidth: b.isCurrent ? 1.4 : 0.8,
    });
    // Coloured cap so the ladder reads low → high at a glance.
    page.drawRectangle({ x, y: yTop - 3, width: boxW, height: 3, color: b.tone });

    const label = ascii(b.label);
    const ls = fitSize(label, bold, boxW - 8, 8.5, 6);
    const lw = bold.widthOfTextAtSize(label, ls);
    page.drawText(label, { x: x + (boxW - lw) / 2, y: yTop - 20, size: ls, font: bold, color: b.tone });

    const range = `${b.minScore} - ${b.maxScore}`;
    const rw = helv.widthOfTextAtSize(range, 8);
    page.drawText(range, { x: x + (boxW - rw) / 2, y: yTop - 34, size: 8, font: helv, color: SLATE });

    if (b.isCurrent) {
      // Pointer under the current band.
      const px = x + boxW / 2;
      const py = yBottom - 2;
      const d = `M ${px - 5},${H - py} L ${px + 5},${H - py} L ${px},${H - (py - 6)} Z`;
      page.drawSvgPath(d, { ...SVG_ANCHOR, color: b.tone, borderWidth: 0 });
    }
  });

  return yTop - boxH - 12;
}

/* ───────────────────────── primitives ───────────────────────── */

function centerText(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: RGB) {
  const t = ascii(text);
  const w = font.widthOfTextAtSize(t, size);
  page.drawText(t, { x: (W - w) / 2, y, size, font, color });
}

/** Indicative horizon when the band carries none — longer as risk rises. */
function horizonForBand(bands: ResolvedBand[], current: ResolvedBand | null): string {
  if (!current || !bands.length) return "-";
  const i = bands.indexOf(current);
  const scale = ["1-3 years", "3-5 years", "5-7 years", "7-10 years", "10+ years"];
  const idx = Math.min(scale.length - 1, Math.round((i / Math.max(1, bands.length - 1)) * (scale.length - 1)));
  return scale[idx];
}

function blend(c: RGB, a: number): RGB {
  return rgb(1 - (1 - c.red) * a, 1 - (1 - c.green) * a, 1 - (1 - c.blue) * a);
}

function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : String(iso));
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function titleCase(s: string): string {
  return String(s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Largest size (stepping down by 0.5 to `min`) at which `text` fits `maxW`. */
function fitSize(text: string, font: PDFFont, maxW: number, start: number, min: number): number {
  let s = start;
  while (s > min && font.widthOfTextAtSize(text, s) > maxW) s -= 0.5;
  return s;
}

function truncate(text: string, font: PDFFont, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 4 && font.widthOfTextAtSize(`${t}...`, size) > maxW) t = t.slice(0, -1);
  return `${t}...`;
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
  const parts = m[1].match(/.{2}/g)!;
  const [r, g, b] = parts.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}

function hexToRgbOr(hex: string | null | undefined, fallback: RGB): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return fallback;
  const parts = m[1].match(/.{2}/g)!;
  const [r, g, b] = parts.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
