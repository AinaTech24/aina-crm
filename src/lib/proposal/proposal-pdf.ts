/**
 * Server-rendered investment-proposal PDF (pdf-lib, no headless Chrome).
 *
 * One renderer for all three copies — the RM's download, the email
 * attachment and the client's own link — so they are always the same document.
 *
 * Reads top to bottom like a distributor's formal proposal:
 *   letterhead (logo · ref · date · ARN)
 *   prepared for / prepared by (client, their risk profile · RM, EUIN, contact)
 *   title, summary, validity, cover note
 *   at a glance — one-time money, monthly SIP, insurance premium and the
 *     illustrative value kept APART (adding a premium to an investment total
 *     made "₹50,01,300 invested" out of ₹50 lakh and a ₹1,300 premium)
 *   recommendations — one table per kind, scheme name wrapped never cut, the
 *     AMC / category / risk-o-meter under it, a total row
 *   assumptions, suitability notes
 *   important disclosures — SEBI / AMFI: distributor status (not an RIA),
 *     market risk, illustrations, commission (SEBI 2009 transparency
 *     circular), regular vs direct plan, risk-o-meter, scheme documents, KYC,
 *     grievance redressal (SCORES); insurance / PMS-AIF / other-product
 *     disclosures only when the proposal carries them; the firm's own
 *     disclaimer last
 *   client acknowledgement + the distributor's signature
 *   footer on every page: firm · "AMFI Registered Mutual Fund Distributor" ·
 *     ARN, the AMFI market-risk sentence, contact line, page x of y
 *
 * A projection is never painted green or called "corpus": it is an
 * illustrative value at an assumed return, and says so wherever it appears.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
import { drawReportHeader, drawContinuationHeader } from "@/lib/pdf/report-header";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import { MANDATORY_RISK_DISCLAIMER } from "@/lib/comms/compliance";
import { itemMonthly, itemOneTime, itemRiskLabel, recommendationType } from "@/lib/proposals/items";

export type ProposalBrand = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  euin?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
  address?: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string } | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
};

/** The RM who prepared the proposal (users row). */
export type ProposalPreparer = {
  name?: string | null;
  euin?: string | null;
  phone?: string | null;
  email?: string | null;
  signatureUrl?: string | null;
};

/** The client's own risk profile, when the proposal is for a client. */
export type ProposalClient = {
  riskProfile?: string | null;
  riskProfileSignedAt?: string | Date | null;
  riskProfileProvisional?: boolean | null;
};

export type ProposalData = {
  title?: string | null;
  proposalNumber?: string | null;
  version?: number | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  summary?: string | null;
  coverLetter?: string | null;
  /** The firm's own extra disclaimer for this proposal — printed after the standard ones. */
  disclaimer?: string | null;
  suitabilityNote?: string | null;
  totalInvestment?: number | string | null;
  expectedCorpus?: number | string | null;
  riskRating?: string | null;
  validUntil?: string | Date | null;
  preparedAt?: string | Date | null;
  products?: Array<Record<string, any>> | null;
};

const INK: RGB = rgb(0.067, 0.094, 0.153);
const SLATE: RGB = rgb(0.278, 0.333, 0.412);
const MUTED: RGB = rgb(0.443, 0.494, 0.565);
const LINE: RGB = rgb(0.878, 0.898, 0.925);
const PANEL: RGB = rgb(0.969, 0.973, 0.98);
const RED: RGB = rgb(0.725, 0.11, 0.11);
const RED_BG: RGB = rgb(0.996, 0.949, 0.949);
const ACCENT: RGB = rgb(0.055, 0.647, 0.914);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);

const A4: [number, number] = [595.28, 841.89];
const M = 40;
/** Content stays above this line; the footer owns the space below. */
const FLOOR = 76;

const KIND_TITLE: Record<string, string> = {
  insurance: "Insurance", pms: "Portfolio Management Services", aif: "Alternative Investment Funds",
  other: "Other investments",
  "mf:sip": "Mutual funds - SIP", "mf:lumpsum": "Mutual funds - Lumpsum",
  "mf:swp": "Mutual funds - Systematic Withdrawal Plan (SWP)", "mf:stp": "Mutual funds - Systematic Transfer Plan (STP)",
};
const KIND_ORDER = ["mf:sip", "mf:lumpsum", "mf:stp", "mf:swp", "pms", "aif", "insurance", "other"];

const TAGLINE = "AMFI Registered Mutual Fund Distributor";

// Glyph switches — set per render from the embedded font (process-stable).
let KEEP_RUPEE = false;
let CUR = "Rs ";

type Col = {
  h: string;
  w: number;
  align?: "l" | "r";
  get: (it: any) => string;
  /** Numeric value for the section's total row. */
  sum?: (it: any) => number | null;
  /** Illustrative (projected) column — drawn bold, never green. */
  illus?: boolean;
  /** Dropped when no line in the table has a value for it (its width is shared out). */
  optional?: boolean;
};

/** Drop optional columns nothing fills, and re-spread their width. */
function fitColumns(cols: Col[], items: any[]): Col[] {
  const kept = cols.filter((c) => !c.optional || items.some((it) => (c.get(it) ?? "-") !== "-"));
  const total = kept.reduce((w, c) => w + c.w, 0) || 1;
  return kept.map((c) => ({ ...c, w: c.w / total }));
}

const n = (v: any): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null;
};

function colsFor(kind: string): Col[] {
  if (kind === "insurance")
    return [
      { h: "Policy", w: 0.32, get: (it) => it.policyName ?? "-" },
      { h: "Insurer / type", w: 0.24, get: (it) => [it.insurer, typeLabel(it.policyType)].filter(Boolean).join(" - ") || "-" },
      { h: "Sum assured", w: 0.16, align: "r", get: (it) => amt(it.sumAssured), sum: (it) => n(it.sumAssured) },
      { h: "Annual premium", w: 0.16, align: "r", get: (it) => amt(it.annualPremium), sum: (it) => n(it.annualPremium) },
      { h: "Term", w: 0.12, align: "r", optional: true, get: (it) => yrs(it.termYears) },
    ];
  if (kind === "pms" || kind === "aif")
    return [
      { h: kind === "pms" ? "Strategy" : "Fund", w: 0.27, get: (it) => it.strategyName ?? it.fundName ?? "-" },
      { h: "Manager", w: 0.17, get: (it) => it.manager ?? "-" },
      { h: "Minimum", w: 0.12, align: "r", optional: true, get: (it) => amt(it.minInvestment) },
      { h: "Proposed", w: 0.13, align: "r", get: (it) => amt(it.proposedAmount), sum: (it) => n(it.proposedAmount) },
      { h: "Assumed return", w: 0.11, align: "r", get: (it) => pctv(it.expectedReturn ?? it.targetIrr) },
      { h: "Years", w: 0.08, align: "r", get: (it) => yrs(it.termYears ?? it.lockInYears) },
      {
        h: "Illustrative*", w: 0.12, align: "r", illus: true,
        get: (it) => amt(projected(it.proposedAmount, it.expectedReturn ?? it.targetIrr, it.termYears ?? it.lockInYears)),
        sum: (it) => projected(it.proposedAmount, it.expectedReturn ?? it.targetIrr, it.termYears ?? it.lockInYears),
      },
    ];
  if (kind === "other")
    return [
      { h: "Product", w: 0.32, get: (it) => it.productName ?? "-" },
      { h: "Issuer", w: 0.24, get: (it) => it.company ?? "-" },
      { h: "Amount", w: 0.16, align: "r", get: (it) => amt(it.amount), sum: (it) => n(it.amount) },
      { h: "Rate", w: 0.12, align: "r", optional: true, get: (it) => pctv(it.expectedReturn) },
      { h: "Term", w: 0.16, align: "r", optional: true, get: (it) => yrs(it.termYears) },
    ];
  if (kind === "mf:lumpsum")
    return [
      { h: "Scheme", w: 0.40, get: (it) => it.schemeName ?? "-" },
      { h: "Amount", w: 0.15, align: "r", get: (it) => amt(it.lumpsum), sum: (it) => n(it.lumpsum) },
      { h: "Years", w: 0.09, align: "r", get: (it) => yrs(it.sipTermYears) },
      { h: "Assumed return", w: 0.14, align: "r", get: (it) => pctv(it.expectedReturn) },
      {
        h: "Illustrative value*", w: 0.22, align: "r", illus: true,
        get: (it) => amt(lumpsumValue(it)), sum: (it) => lumpsumValue(it),
      },
    ];
  if (kind === "mf:swp")
    return [
      { h: "Scheme", w: 0.42, get: (it) => it.schemeName ?? "-" },
      { h: "Corpus", w: 0.18, align: "r", get: (it) => amt(it.corpusRequired), sum: (it) => n(it.corpusRequired) },
      { h: "Withdrawal / month", w: 0.2, align: "r", get: (it) => amt(it.monthlyWithdrawal), sum: (it) => n(it.monthlyWithdrawal) },
      { h: "Period", w: 0.2, align: "r", get: (it) => (n(it.swpPeriodMonths) ? `${it.swpPeriodMonths} months` : "-") },
    ];
  if (kind === "mf:stp")
    return [
      { h: "From scheme", w: 0.3, get: (it) => it.schemeName ?? "-" },
      { h: "To scheme", w: 0.3, get: (it) => it.toSchemeName ?? "-" },
      { h: "Transfer / month", w: 0.14, align: "r", get: (it) => amt(it.monthlyTransfer), sum: (it) => n(it.monthlyTransfer) },
      { h: "Instalments", w: 0.11, align: "r", get: (it) => (n(it.numInstallments) ? String(it.numInstallments) : "-") },
      { h: "Total", w: 0.15, align: "r", get: (it) => amt(stpTotal(it)), sum: (it) => stpTotal(it) },
    ];
  // Mutual funds — SIP (and any MF line from before the split). Lumpsum stays a
  // column: an older line can carry both a starting lumpsum and a SIP.
  return [
    { h: "Scheme", w: 0.30, get: (it) => it.schemeName ?? "-" },
    { h: "Lumpsum", w: 0.12, align: "r", optional: true, get: (it) => amt(it.lumpsum), sum: (it) => n(it.lumpsum) },
    { h: "SIP / month", w: 0.12, align: "r", get: (it) => amt(it.monthlyAmount), sum: (it) => n(it.monthlyAmount) },
    { h: "Step-up", w: 0.08, align: "r", optional: true, get: (it) => pctv(it.stepUpPct) },
    { h: "Years", w: 0.08, align: "r", get: (it) => yrs(it.sipTermYears) },
    { h: "Assumed return", w: 0.12, align: "r", get: (it) => pctv(it.expectedReturn) },
    { h: "Illustrative value*", w: 0.18, align: "r", illus: true, get: (it) => amt(it.projectedCorpus), sum: (it) => n(it.projectedCorpus) },
  ];
}

/** Which table a line belongs in: its kind, with MF split by investment type. */
function groupKey(it: any): string {
  const kind = it?.kind ?? "mf";
  return kind === "mf" ? `mf:${recommendationType(it) ?? "sip"}` : kind;
}

/** The line under a recommendation's name: AMC, category, risk-o-meter, plan. */
function subLine(it: any): string | null {
  if ((it?.kind ?? "mf") === "mf") {
    const risk = itemRiskLabel(it);
    return [
      it.amcName,
      it.category,
      risk ? `Risk-o-meter: ${risk}` : null,
      it.planType === "direct" ? "Direct plan" : it.planType === "regular" ? "Regular plan" : null,
    ].filter(Boolean).join("  |  ") || null;
  }
  if (it?.kind === "aif" && it.category) return `Category ${String(it.category).replace(/^cat/i, "")} AIF`;
  return null;
}

/** Free-text notes the RM attached to a line. */
function noteFor(it: any): string | null {
  const parts = [it?.notes, it?.riderNotes, it?.remarks, it?.exitLoad ? `Exit load: ${it.exitLoad}` : null].filter(
    (x) => typeof x === "string" && x.trim(),
  );
  return parts.length ? parts.join(" - ") : null;
}

export async function renderProposalPdf(args: {
  proposal: ProposalData;
  brand: ProposalBrand;
  preparedBy?: ProposalPreparer | null;
  client?: ProposalClient | null;
  generatedAt?: string;
}): Promise<Buffer> {
  const { proposal: p, brand } = args;
  const prep = args.preparedBy ?? null;
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const doc = await PDFDocument.create();
  const { font: helv, bold, rupeeOk } = await embedPdfFonts(doc);
  KEEP_RUPEE = rupeeOk;
  CUR = rupeeOk ? "₹" : "Rs ";
  const primary = hexToRgb(brand.primaryColor);
  const secondary = brand.secondaryColor ? hexToRgb(brand.secondaryColor) : ACCENT;
  const tint = mix(primary, rgb(1, 1, 1), 0.9);

  const firm = clean(brand.legalName ?? brand.displayName ?? "") || "Your Mutual Fund Distributor";
  const arnNo = brand.arn ? String(brand.arn).replace(/^ARN[-\s:]*/i, "").trim() : "";
  const recipient = clean(p.recipientName ?? "") || "Client";
  const proposalDate = p.preparedAt ?? generatedAt;

  doc.setTitle(clean(`Proposal ${p.proposalNumber ?? ""} - ${recipient}`));
  doc.setProducer("Aina CRM");
  doc.setAuthor(firm);
  if (p.proposalNumber) doc.setSubject(`Ref ${p.proposalNumber}`);

  const [logo, signature] = await Promise.all([embedImage(doc, brand.logoUrl), embedImage(doc, prep?.signatureUrl)]);
  const W = A4[0];
  const usable = W - 2 * M;

  // ── Cursor: pages are added as content overflows ──
  const cur = { page: doc.addPage(A4), y: 0 };
  const newPage = () => {
    cur.page = doc.addPage(A4);
    cur.y = drawContinuationHeader({
      page: cur.page, helv, bold, pageWidth: W, pageHeight: A4[1], margin: M,
      firmName: firm, title: "Investment proposal", primary,
    });
  };
  const ensure = (need: number) => {
    if (cur.y - need < FLOOR) newPage();
  };
  const text = (s: string, x: number, y: number, size: number, font: PDFFont, color: RGB) =>
    cur.page.drawText(s, { x, y, size, font, color });
  /** Wrapped paragraph that flows across pages. */
  const para = (s: string, o: { x?: number; width?: number; size?: number; font?: PDFFont; color?: RGB; lh?: number } = {}) => {
    const x = o.x ?? M, width = o.width ?? usable, size = o.size ?? 9.5, font = o.font ?? helv, lh = o.lh ?? size * 1.42;
    for (const ln of wrapParas(s, font, size, width)) {
      ensure(lh);
      if (ln) text(ln, x, cur.y, size, font, o.color ?? SLATE);
      cur.y -= lh;
    }
  };
  const sectionTitle = (t: string) => {
    ensure(46);
    cur.page.drawRectangle({ x: M, y: cur.y - 2, width: 3, height: 13, color: primary });
    text(clean(t), M + 9, cur.y, 11.5, bold, INK);
    cur.y -= 20;
  };

  // ── Letterhead ──
  cur.y = drawReportHeader({
    page: cur.page, helv, bold, pageWidth: W, pageHeight: A4[1], margin: M, logo,
    firmName: firm,
    title: "INVESTMENT PROPOSAL",
    subtitles: [
      p.proposalNumber ? `Ref ${p.proposalNumber}${n(p.version) && Number(p.version) > 1 ? ` (version ${p.version})` : ""}` : null,
      `Dated ${fmtDate(proposalDate)}`,
    ],
    arn: arnNo || null,
    primary,
    secondary,
  });

  // ── Prepared for / prepared by ──
  {
    const client = args.client ?? null;
    const riskLine = client?.riskProfile
      ? `Risk profile: ${humanise(client.riskProfile)}${client.riskProfileProvisional ? " (provisional)" : client.riskProfileSignedAt ? `, assessed ${fmtDate(client.riskProfileSignedAt)}` : ""}`
      : null;
    const left: Line[] = [
      { t: recipient, f: bold, s: 11, c: INK },
      p.recipientEmail ? { t: clean(p.recipientEmail), f: helv, s: 8.5, c: SLATE } : null,
      p.recipientPhone ? { t: clean(p.recipientPhone), f: helv, s: 8.5, c: SLATE } : null,
      riskLine ? { t: riskLine, f: helv, s: 8.5, c: SLATE } : null,
    ].filter(Boolean) as Line[];
    const right: Line[] = [
      { t: clean(prep?.name ?? "") || firm, f: bold, s: 11, c: INK },
      prep?.name ? { t: firm, f: helv, s: 8.5, c: SLATE } : null,
      prep?.euin ? { t: `EUIN ${clean(prep.euin)}`, f: helv, s: 8.5, c: SLATE } : null,
      prep?.phone || prep?.email
        ? { t: [prep?.phone, prep?.email].filter(Boolean).map((v) => clean(String(v))).join("  |  "), f: helv, s: 8.5, c: SLATE }
        : null,
    ].filter(Boolean) as Line[];
    const colW = (usable - 12) / 2;
    const lh = (l: Line) => (l.s > 10 ? 15 : 12.5);
    const bodyH = (ls: Line[]) => ls.reduce((h, l) => h + lh(l), 0);
    const h = 30 + Math.max(bodyH(left), bodyH(right)) + 4;
    ensure(h + 10);
    const box = (x: number, label: string, ls: Line[]) => {
      cur.page.drawRectangle({ x, y: cur.y - h, width: colW, height: h, color: PANEL, borderColor: LINE, borderWidth: 0.8 });
      cur.page.drawRectangle({ x, y: cur.y - 2, width: colW, height: 2, color: primary });
      text(label, x + 12, cur.y - 17, 7, bold, MUTED);
      let y = cur.y - 33;
      for (const l of ls) {
        text(truncate(l.t, l.f, l.s, colW - 24), x + 12, y, l.s, l.f, l.c);
        y -= lh(l);
      }
    };
    box(M, "PREPARED FOR", left);
    box(M + colW + 12, "PREPARED BY", right);
    cur.y -= h + 24;
  }

  // ── Title, summary, validity ──
  {
    const rawTitle = clean(p.title ?? "");
    const title = !rawTitle || /^investment proposal$/i.test(rawTitle) ? `Investment proposal for ${recipient}` : rawTitle;
    for (const ln of wrapParas(title, bold, 16, usable).slice(0, 3)) {
      ensure(20);
      text(ln, M, cur.y, 16, bold, INK);
      cur.y -= 20;
    }
    if (p.summary && p.summary.trim()) {
      cur.y += 2;
      para(p.summary, { size: 10, color: SLATE });
    }
    cur.y -= 4;
    ensure(18);
    let x = M;
    const meta = (label: string, value: string) => {
      text(label, x, cur.y, 8.5, helv, MUTED);
      x += helv.widthOfTextAtSize(label, 8.5) + 4;
      text(value, x, cur.y, 8.5, bold, INK);
      x += bold.widthOfTextAtSize(value, 8.5) + 18;
    };
    meta("Proposal date", fmtDate(proposalDate));
    if (p.validUntil) {
      meta("Valid until", fmtDate(p.validUntil));
      if (istDay(p.validUntil) < istDay(generatedAt)) {
        // A validity date in the past is said, not hidden.
        const chip = "Validity has lapsed";
        const cw = bold.widthOfTextAtSize(chip, 7) + 12;
        cur.page.drawRectangle({ x: x - 8, y: cur.y - 3.5, width: cw, height: 13, color: RED_BG, borderColor: RED, borderWidth: 0.5 });
        text(chip, x - 2, cur.y, 7, bold, RED);
        x += cw + 10;
      }
    }
    if (p.riskRating) meta("Proposal risk level", humanise(p.riskRating));
    cur.y -= 22;
  }

  // ── Cover note — paragraphs kept, flows across pages ──
  if (p.coverLetter && p.coverLetter.trim()) {
    para(p.coverLetter, { size: 9.5, color: SLATE, lh: 13.6 });
    cur.y -= 10;
  }

  // ── At a glance ──
  const products = (p.products ?? []) as any[];
  {
    let oneTime = 0, monthly = 0, premium = 0, illus = 0;
    for (const it of products) {
      oneTime += itemOneTime(it) ?? 0;
      monthly += itemMonthly(it) ?? 0;
      if (it?.kind === "insurance") premium += n(it.annualPremium) ?? 0;
      illus += illustrativeOf(it) ?? 0;
    }
    if (!products.length) oneTime = n(p.totalInvestment) ?? 0;
    if (!illus) illus = n(p.expectedCorpus) ?? 0;
    const tiles: Array<{ label: string; value: string; sub?: string }> = [];
    if (oneTime) tiles.push({ label: "One-time investment", value: amt(oneTime) });
    if (monthly) tiles.push({ label: "Monthly SIP", value: amt(monthly), sub: "per month" });
    if (premium) tiles.push({ label: "Insurance premium", value: amt(premium), sub: "per year" });
    if (illus) tiles.push({ label: "Illustrative value*", value: amt(illus), sub: "at assumed returns" });
    if (tiles.length) {
      sectionTitle("At a glance");
      const gap = 10, th = 56;
      const tw = (usable - gap * (tiles.length - 1)) / tiles.length;
      ensure(th + 8);
      tiles.forEach((t, i) => {
        const x = M + i * (tw + gap);
        cur.page.drawRectangle({ x, y: cur.y - th, width: tw, height: th, color: PANEL, borderColor: LINE, borderWidth: 0.8 });
        cur.page.drawRectangle({ x, y: cur.y - th, width: 2.5, height: th, color: primary });
        text(t.label.toUpperCase(), x + 12, cur.y - 15, 6.8, bold, MUTED);
        const vs = fitText(t.value, bold, 14, tw - 22, 8);
        text(t.value, x + 12, cur.y - 35, vs, bold, INK);
        if (t.sub) text(t.sub, x + 12, cur.y - 48, 7, helv, MUTED);
      });
      cur.y -= th + 26;
    }
  }

  // ── Recommendations ──
  const groups: Record<string, any[]> = {};
  for (const it of products) (groups[groupKey(it)] ??= []).push(it);
  const kinds = Object.keys(groups).sort((a, b) => rank(a) - rank(b));
  if (kinds.length) sectionTitle("Recommendations");

  for (const kind of kinds) {
    const items = groups[kind];
    const cols = fitColumns(colsFor(kind), items);
    const headH = 18;
    const drawHead = () => {
      cur.page.drawRectangle({ x: M, y: cur.y - headH + 5, width: usable, height: headH, color: tint });
      let x = M + 6;
      for (const c of cols) {
        const cw = c.w * usable;
        const h = c.h;
        const fs = fitText(h, bold, 7, cw - 8, 5.5);
        const hx = c.align === "r" ? x + cw - 12 - bold.widthOfTextAtSize(h, fs) : x;
        text(h, hx, cur.y - 7, fs, bold, darken(primary));
        x += cw;
      }
      cur.y -= headH + 3;
    };

    ensure(70);
    text(clean(KIND_TITLE[kind] ?? kind), M, cur.y, 9.5, bold, primary);
    const count = `${items.length} recommendation${items.length === 1 ? "" : "s"}`;
    text(count, M + usable - helv.widthOfTextAtSize(count, 7.5), cur.y, 7.5, helv, MUTED);
    cur.y -= 12;
    drawHead();

    items.forEach((it, idx) => {
      const nameW = cols[0].w * usable - 12;
      const nameLines = wrapParas(clean(String(cols[0].get(it) ?? "-")), bold, 8.6, nameW).slice(0, 2);
      const sub = subLine(it);
      const subLines = sub ? wrapParas(clean(sub), helv, 6.8, nameW).slice(0, 3) : [];
      const note = noteFor(it);
      const noteLines = note ? wrapParas(`Note: ${clean(note)}`, helv, 7, usable - 12) : [];
      const rowH = 8 + nameLines.length * 11 + subLines.length * 9 + (noteLines.length ? noteLines.length * 9.5 + 2 : 0) + 4;
      const before = cur.page;
      ensure(rowH);
      if (cur.page !== before) drawHead(); // a fresh page repeats the header

      const top = cur.y + 3;
      if (idx % 2 === 1) cur.page.drawRectangle({ x: M, y: top - rowH, width: usable, height: rowH, color: PANEL });
      let x = M + 6;
      cols.forEach((c, ci) => {
        const cw = c.w * usable;
        const firstY = cur.y - 6;
        if (ci === 0) {
          let y = firstY;
          for (const ln of nameLines) { text(ln, x, y, 8.6, bold, INK); y -= 11; }
          for (const ln of subLines) { text(ln, x, y + 1, 6.8, helv, MUTED); y -= 9; }
        } else {
          const val = clean(String(c.get(it) ?? "-"));
          if (c.align === "r") {
            // Money is never chopped — "Rs 11,5..." reads as a wrong amount.
            const f = c.illus ? bold : helv;
            const fs = fitText(val, f, 8.6, cw - 12, 6);
            text(val, x + cw - 12 - f.widthOfTextAtSize(val, fs), firstY, fs, f, INK);
          } else {
            const ls = wrapParas(val, helv, 8.6, cw - 10).slice(0, 2);
            let y = firstY;
            for (const ln of ls) { text(ln, x, y, 8.6, helv, INK); y -= 11; }
          }
        }
        x += cw;
      });
      if (noteLines.length) {
        let y = top - rowH + 5 + (noteLines.length - 1) * 9.5;
        for (const ln of noteLines) { text(ln, M + 6, y, 7, helv, SLATE); y -= 9.5; }
      }
      cur.page.drawLine({ start: { x: M, y: top - rowH }, end: { x: M + usable, y: top - rowH }, thickness: 0.6, color: LINE });
      cur.y = top - rowH - 3;
    });

    // Total row — only where there is more than one line to add up.
    if (items.length > 1 && cols.some((c) => c.sum)) {
      ensure(20);
      const top = cur.y + 3;
      cur.page.drawRectangle({ x: M, y: top - 18, width: usable, height: 18, color: tint });
      let x = M + 6;
      cols.forEach((c, ci) => {
        const cw = c.w * usable;
        if (ci === 0) text("Total", x, cur.y - 8, 8.6, bold, INK);
        else if (c.sum) {
          const total = items.reduce((s, it) => s + (c.sum!(it) ?? 0), 0);
          const val = total ? amt(total) : "";
          const fs = fitText(val, bold, 8.6, cw - 12, 6);
          text(val, x + cw - 12 - bold.widthOfTextAtSize(val, fs), cur.y - 8, fs, bold, INK);
        }
        x += cw;
      });
      cur.y = top - 18 - 3;
    }
    cur.y -= 18;
  }

  // ── Assumptions and suitability ──
  {
    const hasIllus = products.some((it) => illustrativeOf(it));
    const reasons = products
      .filter((it) => typeof it?.suitabilityReason === "string" && it.suitabilityReason.trim())
      .map((it) => `${clean(String(it.schemeName ?? "A scheme"))} sits above your risk profile. Reason: ${clean(it.suitabilityReason)}`);
    const notes: string[] = [];
    if (hasIllus) {
      notes.push(
        "* Illustrative values are calculated at the assumed annual rate of return shown against each recommendation, over the period stated. They do not account for taxes or exit loads.",
        "Assumed returns are not guaranteed and are not an indication of any scheme's future performance. Mutual funds do not offer assured returns; the actual value of your investment may be higher or lower.",
      );
    }
    if (p.suitabilityNote && p.suitabilityNote.trim()) notes.push(`Suitability: ${clean(p.suitabilityNote)}`);
    notes.push(...reasons);
    if (notes.length) {
      sectionTitle("Assumptions and suitability");
      for (const t of notes) bullet(t);
      cur.y -= 8;
    }
  }

  // ── Important disclosures (SEBI / AMFI) ──
  {
    sectionTitle("Important disclosures");
    para("Issued in line with SEBI and AMFI requirements for mutual fund distributors. Please read before you invest.", { size: 8.2, color: MUTED });
    cur.y -= 4;
    const has = (k: string) => products.some((it) => (it?.kind ?? "mf") === k);
    const reg = `${firm} is an AMFI Registered Mutual Fund Distributor${arnNo ? ` (ARN-${arnNo})` : ""}${prep?.euin ? `; this proposal was prepared by ${clean(prep.name ?? "our employee")} (EUIN ${clean(prep.euin)})` : ""}.`;
    const items: Array<[string, string]> = [
      ["Distributor, not an investment adviser",
        `${reg} We are not registered with SEBI as an Investment Adviser or Portfolio Manager. The recommendations in this proposal are incidental to our distribution services and are not investment advice under the SEBI (Investment Advisers) Regulations, 2013.`],
      ["Market risk",
        `${MANDATORY_RISK_DISCLAIMER} Past performance may or may not be sustained in future and is not a guarantee of future returns. The value of investments and the income from them can go down as well as up.`],
      ["Illustrations are not promises",
        "Every projected or illustrative value in this proposal is computed at an assumed rate of return for illustration only. It is not guaranteed and is not an indication of future performance."],
      ["Commission disclosure",
        `${firm} receives commission from the Asset Management Companies (AMCs) of the schemes recommended, as trail commission paid out of the scheme's Total Expense Ratio (TER), in line with SEBI's transparency norms for distributors. Details of the commission payable for the recommended schemes and their competing schemes are available from us on request.`],
      ["Regular and Direct plans",
        "Schemes are offered through their Regular Plan, from which distributor commission is paid. Every scheme also has a Direct Plan with a lower expense ratio and no distributor commission, which you may choose to invest in directly with the AMC."],
      ["Suitability and risk-o-meter",
        "These recommendations are based on the risk profile and information you have shared with us. Please check each scheme's risk-o-meter and investment objective in its scheme documents and confirm that they match your own risk appetite; where a scheme sits above your risk profile, the reason is stated in this proposal."],
      ["Scheme documents and KYC",
        "Please read the Scheme Information Document (SID), Statement of Additional Information (SAI) and Key Information Memorandum (KIM) of each scheme before investing. All investments are subject to completion of KYC as required by SEBI."],
    ];
    if (has("insurance"))
      items.push(["Insurance",
        "Insurance is the subject matter of solicitation. Please read the sales brochure and policy wording carefully before concluding a sale. In Unit Linked Insurance Plans (ULIPs), the investment risk in the investment portfolio is borne by the policyholder."]);
    if (has("pms") || has("aif"))
      items.push(["PMS and AIF",
        "Portfolio Management Services and Alternative Investment Funds carry higher risk, have minimum investment requirements prescribed by SEBI and may have limited liquidity or lock-in. Please read the Disclosure Document or Private Placement Memorandum carefully before investing."]);
    if (has("other"))
      items.push(["Other products",
        "Fixed deposits, bonds and other products in this proposal are not mutual fund products. They carry the issuer's credit risk and are governed by the issuer's own terms and conditions."]);
    const contact = [brand.email, brand.phone].filter(Boolean).map((v) => clean(String(v))).join(" or ");
    items.push(["Grievance redressal",
      `For any query or complaint, please contact us${contact ? ` at ${contact}` : ""}. If your complaint is not resolved, you may approach the AMC concerned or lodge a complaint on SEBI SCORES (https://scores.sebi.gov.in).`]);
    items.push(["Validity",
      `This proposal reflects market conditions and the information available on ${fmtDate(proposalDate)}${p.validUntil ? ` and is valid until ${fmtDate(p.validUntil)}` : ""}. It is not an offer or solicitation to buy or sell any security.`]);
    if (p.disclaimer && p.disclaimer.trim()) items.push(["Additional disclosure", clean(p.disclaimer)]);

    items.forEach(([head, body], i) => {
      const num = `${i + 1}.`;
      const indent = 20;
      const lines = wrapParas(body, helv, 8, usable - indent);
      ensure(11 + Math.min(lines.length, 3) * 11);
      text(num, M + indent - 5 - bold.widthOfTextAtSize(num, 8.2), cur.y, 8.2, bold, primary);
      text(head, M + indent, cur.y, 8.2, bold, INK);
      cur.y -= 11.5;
      for (const ln of lines) {
        ensure(11);
        text(ln, M + indent, cur.y, 8, helv, SLATE);
        cur.y -= 11;
      }
      cur.y -= 5;
    });
  }

  // ── Acknowledgement and signatures ──
  {
    const h = 128;
    if (cur.y - h - 18 < FLOOR) newPage();
    else cur.y -= 6;
    sectionTitle("Acknowledgement");
    const colW = (usable - 12) / 2;
    const top = cur.y;
    const box = (x: number) =>
      cur.page.drawRectangle({ x, y: top - h, width: colW, height: h, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.8 });
    box(M);
    box(M + colW + 12);

    // Client
    let y = top - 16;
    for (const ln of wrapParas(
      "I confirm that I have read this proposal, including the important disclosures, and that the recommendations are in line with my risk profile and investment objectives. I understand that illustrative values are not guaranteed.",
      helv, 7.6, colW - 24,
    )) { text(ln, M + 12, y, 7.6, helv, SLATE); y -= 10.5; }
    const sigY = top - h + 30;
    cur.page.drawLine({ start: { x: M + 12, y: sigY }, end: { x: M + colW - 12, y: sigY }, thickness: 0.6, color: MUTED });
    text(truncate(`Signature of ${recipient}`, helv, 7.5, colW * 0.6), M + 12, sigY - 11, 7.5, helv, MUTED);
    text("Date: ____________", M + colW - 12 - helv.widthOfTextAtSize("Date: ____________", 7.5), sigY - 11, 7.5, helv, MUTED);

    // Distributor
    const rx = M + colW + 12;
    text(truncate(`For ${firm}`, bold, 8.6, colW - 24), rx + 12, top - 16, 8.6, bold, INK);
    if (signature) {
      const maxH = 40, maxW = colW - 24;
      let dw = (signature.width / signature.height) * maxH, dh = maxH;
      if (dw > maxW) { dw = maxW; dh = (signature.height / signature.width) * maxW; }
      cur.page.drawImage(signature, { x: rx + 12, y: sigY + 4, width: dw, height: dh });
    }
    cur.page.drawLine({ start: { x: rx + 12, y: sigY }, end: { x: rx + colW - 12, y: sigY }, thickness: 0.6, color: MUTED });
    const who = [clean(prep?.name ?? "") || "Authorised signatory", prep?.euin ? `EUIN ${clean(prep.euin)}` : null].filter(Boolean).join("  |  ");
    text(truncate(who, helv, 7.5, colW - 24), rx + 12, sigY - 11, 7.5, helv, MUTED);
    const dated = `Dated ${fmtDate(proposalDate)}`;
    text(dated, rx + 12, sigY - 22, 7.5, helv, MUTED);
    cur.y = top - h - 10;
  }

  // ── Footer on every page ──
  const pages = doc.getPages();
  pages.forEach((pg, i) => drawFooter(pg, {
    helv, bold, firm, arnNo, brand, refId: p.proposalNumber, page: i + 1, of: pages.length, primary,
  }));

  return Buffer.from(await doc.save());

  /* ── local helpers that draw at the cursor ── */
  function bullet(t: string) {
    const lines = wrapParas(t, helv, 8.4, usable - 14);
    ensure(12);
    cur.page.drawRectangle({ x: M + 2, y: cur.y + 2, width: 3, height: 3, color: primary });
    for (const ln of lines) {
      ensure(11.5);
      text(ln, M + 14, cur.y, 8.4, helv, SLATE);
      cur.y -= 11.5;
    }
    cur.y -= 3;
  }
}

type Line = { t: string; f: PDFFont; s: number; c: RGB };

/* ── footer ── */
function drawFooter(page: PDFPage, a: {
  helv: PDFFont; bold: PDFFont; firm: string; arnNo: string; brand: ProposalBrand;
  refId?: string | null; page: number; of: number; primary: RGB;
}) {
  const W = page.getWidth();
  const usable = W - 2 * M;
  page.drawRectangle({ x: M, y: 58, width: usable, height: 0.8, color: LINE });
  // A distributor, not an adviser — and the ARN only when there is one
  // (an empty ARN used to print "ARN--").
  const left = [a.firm, TAGLINE, a.arnNo ? `ARN-${a.arnNo}` : null].filter(Boolean).join("  |  ");
  page.drawText(truncate(left, a.bold, 7.4, usable), { x: M, y: 46, size: 7.4, font: a.bold, color: SLATE });
  const right = [a.refId ? `Ref ${clean(a.refId)}` : null, `Page ${a.page} of ${a.of}`].filter(Boolean).join("  |  ");
  const rw = a.helv.widthOfTextAtSize(right, 7);
  page.drawText(right, { x: W - M - rw, y: 35, size: 7, font: a.helv, color: MUTED });
  page.drawText(truncate(MANDATORY_RISK_DISCLAIMER, a.helv, 7, usable - rw - 16), { x: M, y: 35, size: 7, font: a.helv, color: MUTED });
  const addr = a.brand.address
    ? [a.brand.address.line1, a.brand.address.line2, a.brand.address.city, a.brand.address.state, a.brand.address.pincode].filter(Boolean).join(", ")
    : "";
  const contact = [addr, a.brand.phone, a.brand.email, a.brand.website].filter(Boolean).map((v) => clean(String(v))).join("  |  ");
  if (contact) page.drawText(truncate(contact, a.helv, 6.6, usable), { x: M, y: 25, size: 6.6, font: a.helv, color: MUTED });
}

/* ── value helpers ── */
function projected(amount: any, ret: any, years: any): number | null {
  const a = Number(amount), r = Number(ret), y = Number(years);
  if (!isFinite(a) || a <= 0 || !isFinite(r) || !isFinite(y) || y <= 0) return null;
  return Math.round(a * Math.pow(1 + r / 100, y));
}
function lumpsumValue(it: any): number | null {
  return n(it.projectedCorpus) ?? projected(it.lumpsum, it.expectedReturn, it.sipTermYears);
}
function stpTotal(it: any): number | null {
  const m = n(it.monthlyTransfer), k = n(it.numInstallments);
  return m && k ? m * k : null;
}
/** The illustrative value a line contributes to the at-a-glance total. */
function illustrativeOf(it: any): number | null {
  const kind = groupKey(it);
  if (kind === "mf:sip") return n(it.projectedCorpus);
  if (kind === "mf:lumpsum") return lumpsumValue(it);
  if (kind === "pms" || kind === "aif") return projected(it.proposedAmount, it.expectedReturn ?? it.targetIrr, it.termYears ?? it.lockInYears);
  return null;
}
function rank(kind: string): number {
  const i = KIND_ORDER.indexOf(kind);
  return i < 0 ? 99 : i;
}
function amt(v: any): string {
  const x = typeof v === "string" ? Number(v) : v;
  if (x == null || !isFinite(x) || x === 0) return "-";
  return CUR + Math.round(x).toLocaleString("en-IN");
}
function yrs(v: any): string {
  const x = Number(v);
  return isFinite(x) && x > 0 ? `${x} yrs` : "-";
}
function pctv(v: any): string {
  const x = Number(v);
  return isFinite(x) && x !== 0 ? `${x}%` : "-";
}
function typeLabel(t: any): string | null {
  if (!t) return null;
  return t === "ulip" ? "ULIP" : humanise(String(t));
}
function humanise(s: string): string {
  return clean(String(s).replace(/_/g, " ")).replace(/^\w/, (c) => c.toUpperCase());
}
function fmtDate(v: string | Date): string {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
/** yyyy-mm-dd in India time, for date comparisons. */
function istDay(v: string | Date): string {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/* ── drawing helpers ── */
function absUrl(url: string): string {
  if (/^(https?:|data:)/i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${url.startsWith("/") ? "" : "/"}${url}` : url;
}
async function embedImage(doc: PDFDocument, rawUrl?: string | null): Promise<PDFImage | null> {
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
function fitText(t: string, font: PDFFont, size: number, maxWidth: number, min: number): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(t, s) > maxWidth) s -= 0.5;
  return s;
}
function truncate(t: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}...`;
}
/** Wrap text that may hold several paragraphs; a blank line stays a blank line. */
function wrapParas(t: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  const paras = String(t ?? "").replace(/\r/g, "").split(/\n/);
  paras.forEach((raw, pi) => {
    const para = clean(raw);
    if (!para) {
      if (pi > 0 && pi < paras.length - 1 && out[out.length - 1] !== "") out.push("");
      return;
    }
    let line = "";
    for (const w of para.split(" ")) {
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth || !line) line = trial;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  });
  return out.length ? out : [""];
}
/** One line of text the embedded font can draw (keeps ₹ when the font has it). */
function clean(s: string): string {
  if (!s) return "";
  return pdfSanitize(String(s).replace(/·/g, "-"), KEEP_RUPEE);
}
function hexToRgb(hex: string | null | undefined): RGB {
  const m = (hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return DEFAULT_PRIMARY;
  const [r, g, b] = m[1].match(/.{2}/g)!.map((x) => parseInt(x, 16) / 255);
  return rgb(r, g, b);
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return rgb(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t);
}
function darken(c: RGB): RGB {
  return mix(c, rgb(0, 0, 0), 0.25);
}
