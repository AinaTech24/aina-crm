/**
 * Server-rendered investment-proposal PDF (pdf-lib, no headless Chrome).
 *
 * One renderer for all three copies — the RM's download, the email
 * attachment and the client's own link — so they are always the same document.
 *
 * Reads top to bottom like a distributor's formal proposal:
 *   letterhead (logo · the firm, ARN and how to reach it)
 *   title ("Prepared for <client>") and the key facts: reference, dates,
 *     proposal risk level
 *   client / prepared by (their risk profile · RM, EUIN, contact)
 *   summary, cover note
 *   at a glance — one-time money, monthly SIP, insurance premium and the
 *     illustrative value kept APART (adding a premium to an investment total
 *     made "₹50,01,300 invested" out of ₹50 lakh and a ₹1,300 premium)
 *   recommendations — one table per kind, scheme name wrapped never cut, the
 *     AMC / category / risk-o-meter / plan under it, a total row
 *   assumptions, suitability notes
 *   important disclosures — SEBI / AMFI: distributor status (not an RIA),
 *     market risk, illustrations, commission (SEBI 2009 transparency
 *     circular), regular vs direct plan, risk-o-meter, scheme documents, KYC,
 *     grievance redressal (SCORES); insurance / PMS-AIF / other-product
 *     disclosures only when the proposal carries them; the firm's own
 *     disclaimer last. Set as two columns of fine print — every word kept.
 *   client acknowledgement + the distributor's signature
 *   footer on every page: firm · "AMFI Registered Mutual Fund Distributor" ·
 *     ARN, the AMFI market-risk sentence IN FULL, contact line, page x of y
 *
 * The look (2026-10-07, the firm asked for "clean and professional"): ink on
 * white, hairline rules, the brand colour only as an accent (eyebrow, section
 * marks, group titles), labels in small spaced capitals. The letterhead is
 * drawn here rather than by lib/pdf/report-header, which other reports share.
 *
 * A projection is never painted green or called "corpus": it is an
 * illustrative value at an assumed return, and says so wherever it appears.
 */

import { PDFDocument, rgb, setCharacterSpacing, type PDFFont, type PDFPage, type PDFImage, type RGB } from "pdf-lib";
import { embedPdfFonts, pdfSanitize } from "@/lib/pdf/fonts";
import { MANDATORY_RISK_DISCLAIMER } from "@/lib/comms/compliance";
import { itemMonthly, itemOneTime, itemRiskLabel, recommendationType } from "@/lib/proposals/items";
import { formatPhone } from "@/lib/utils";

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

/* ── palette: ink on white, the brand colour only as an accent ── */
const INK: RGB = rgb(0.067, 0.094, 0.153); // headings, figures
const BODY: RGB = rgb(0.2, 0.255, 0.333); // running text
const MUTED: RGB = rgb(0.392, 0.455, 0.545); // labels, captions
const FAINT: RGB = rgb(0.58, 0.635, 0.71); // the footer's contact line, separators
const LINE: RGB = rgb(0.886, 0.91, 0.941); // hairlines
const RULE: RGB = rgb(0.796, 0.835, 0.882); // table header and total rules
const PANEL: RGB = rgb(0.973, 0.98, 0.988); // the client / prepared-by panel
const RED: RGB = rgb(0.725, 0.11, 0.11);
const RED_BG: RGB = rgb(0.996, 0.949, 0.949);
const DEFAULT_PRIMARY: RGB = rgb(0.055, 0.145, 0.341);

const A4: [number, number] = [595.28, 841.89];
const M = 46;
/** Content stays above this line; the footer owns the space below. */
const FLOOR = 84;

const KIND_TITLE: Record<string, string> = {
  insurance: "Insurance cover", pms: "Portfolio Management Services", aif: "Alternative Investment Funds",
  other: "Other investments",
  "mf:sip": "Mutual funds: SIP", "mf:lumpsum": "Mutual funds: Lumpsum",
  "mf:swp": "Mutual funds: Systematic Withdrawal Plan (SWP)", "mf:stp": "Mutual funds: Systematic Transfer Plan (STP)",
};
const KIND_ORDER = ["mf:sip", "mf:lumpsum", "mf:stp", "mf:swp", "pms", "aif", "insurance", "other"];

const TAGLINE = "AMFI Registered Mutual Fund Distributor";
const ACKNOWLEDGEMENT =
  "I confirm that I have read this proposal, including the important disclosures, and that the recommendations are in line with my risk profile and investment objectives. I understand that illustrative values are not guaranteed.";

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
      { h: "Policy", w: 0.46, get: (it) => insuranceName(it) },
      { h: "Sum assured", w: 0.2, align: "r", get: (it) => amt(it.sumAssured), sum: (it) => n(it.sumAssured) },
      { h: "Annual premium", w: 0.2, align: "r", get: (it) => amt(it.annualPremium), sum: (it) => n(it.annualPremium) },
      { h: "Term", w: 0.14, align: "r", optional: true, get: (it) => yrs(it.termYears) },
    ];
  if (kind === "pms" || kind === "aif")
    return [
      { h: kind === "pms" ? "Strategy" : "Fund", w: 0.27, get: (it) => it.strategyName ?? it.fundName ?? "-" },
      { h: "Manager", w: 0.17, get: (it) => it.manager ?? "-" },
      { h: "Minimum", w: 0.12, align: "r", optional: true, get: (it) => amt(it.minInvestment) },
      { h: "Proposed", w: 0.13, align: "r", get: (it) => amt(it.proposedAmount), sum: (it) => n(it.proposedAmount) },
      { h: "Assumed return", w: 0.11, align: "r", optional: true, get: (it) => pctv(it.expectedReturn ?? it.targetIrr) },
      { h: "Years", w: 0.08, align: "r", optional: true, get: (it) => yrs(it.termYears ?? it.lockInYears) },
      {
        h: "Illustrative*", w: 0.12, align: "r", illus: true, optional: true,
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
      { h: "Years", w: 0.09, align: "r", optional: true, get: (it) => yrs(it.sipTermYears) },
      { h: "Assumed return", w: 0.14, align: "r", optional: true, get: (it) => pctv(it.expectedReturn) },
      {
        h: "Illustrative value*", w: 0.22, align: "r", illus: true, optional: true,
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
    { h: "Years", w: 0.08, align: "r", optional: true, get: (it) => yrs(it.sipTermYears) },
    { h: "Assumed return", w: 0.12, align: "r", optional: true, get: (it) => pctv(it.expectedReturn) },
    { h: "Illustrative value*", w: 0.18, align: "r", illus: true, optional: true, get: (it) => amt(it.projectedCorpus), sum: (it) => n(it.projectedCorpus) },
  ];
}

/** Which table a line belongs in: its kind, with MF split by investment type. */
function groupKey(it: any): string {
  const kind = it?.kind ?? "mf";
  return kind === "mf" ? `mf:${recommendationType(it) ?? "sip"}` : kind;
}

/** The facts under a recommendation's name: AMC, category, risk-o-meter, plan. */
function subParts(it: any): string[] {
  if ((it?.kind ?? "mf") === "mf") {
    const risk = itemRiskLabel(it);
    return [
      it.amcName,
      it.category,
      risk ? `Risk-o-meter: ${risk}` : null,
      it.planType === "direct" ? "Direct plan" : it.planType === "regular" ? "Regular plan" : null,
    ].filter(Boolean).map((s) => clean(String(s)));
  }
  if (it?.kind === "aif" && it.category) return [`Category ${String(it.category).replace(/^cat/i, "")} AIF`];
  if (it?.kind === "insurance" && insuranceName(it) === clean(String(it.policyName ?? ""))) {
    return [it.insurer, typeLabel(it.policyType) ? `${typeLabel(it.policyType)} plan` : null].filter(Boolean).map((s) => clean(String(s)));
  }
  return [];
}

/**
 * The policy's name. When the RM typed the insurer as the policy name
 * ("HDFC" beside "HDFC - Term"), the name is built from the insurer and the
 * plan type instead, so the table never says the same thing twice.
 */
function insuranceName(it: any): string {
  const name = clean(String(it?.policyName ?? "")).trim();
  const insurer = clean(String(it?.insurer ?? "")).trim();
  if (name && name.toLowerCase() !== insurer.toLowerCase()) return name;
  const type = typeLabel(it?.policyType);
  return [insurer, type ? `${type} plan` : null].filter(Boolean).join(" ") || name || "Insurance policy";
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

  const firm = clean(brand.legalName ?? brand.displayName ?? "") || "Your Mutual Fund Distributor";
  const arnNo = brand.arn ? String(brand.arn).replace(/^ARN[-\s:]*/i, "").trim() : "";
  const recipient = clean(p.recipientName ?? "") || "Client";
  const proposalDate = p.preparedAt ?? generatedAt;
  const ref = p.proposalNumber ? clean(p.proposalNumber) : "";

  doc.setTitle(clean(`Proposal ${p.proposalNumber ?? ""} - ${recipient}`));
  doc.setProducer("Aina CRM");
  doc.setAuthor(firm);
  if (p.proposalNumber) doc.setSubject(`Ref ${p.proposalNumber}`);

  const [logo, signature] = await Promise.all([embedImage(doc, brand.logoUrl), embedImage(doc, prep?.signatureUrl)]);
  const W = A4[0];
  const H = A4[1];
  const usable = W - 2 * M;

  // ── Cursor: pages are added as content overflows ──
  const cur = { page: doc.addPage(A4), y: 0 };
  const text = (s: string, x: number, y: number, size: number, font: PDFFont, color: RGB) =>
    cur.page.drawText(s, { x, y, size, font, color });
  /** Small spaced capitals — the labels' voice. */
  const label = (s: string, x: number, y: number, color: RGB = MUTED, size = 6.5) => {
    cur.page.pushOperators(setCharacterSpacing(0.6));
    cur.page.drawText(clean(s).toUpperCase(), { x, y, size, font: bold, color });
    cur.page.pushOperators(setCharacterSpacing(0));
  };
  const labelWidth = (s: string, size = 6.5) => {
    const t = clean(s).toUpperCase();
    return bold.widthOfTextAtSize(t, size) + 0.6 * Math.max(0, t.length - 1);
  };
  const hairline = (y: number, x1 = M, x2 = M + usable, color: RGB = LINE, thickness = 0.8) =>
    cur.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });

  const newPage = () => {
    cur.page = doc.addPage(A4);
    // A slim running head: who and what, then the same rule as the letterhead.
    const top = H - 40;
    text(truncate(firm, bold, 8.2, usable * 0.55), M, top, 8.2, bold, INK);
    const r = ["Investment proposal", ref ? `Ref ${ref}` : null].filter(Boolean).join("  |  ");
    text(r, W - M - helv.widthOfTextAtSize(r, 7.4), top, 7.4, helv, MUTED);
    hairline(top - 10);
    cur.page.drawRectangle({ x: M, y: top - 10.9, width: 28, height: 1.8, color: primary });
    cur.y = top - 38;
  };
  const ensure = (need: number) => {
    if (cur.y - need < FLOOR) newPage();
  };
  /** Wrapped paragraph that flows across pages. */
  const para = (s: string, o: { x?: number; width?: number; size?: number; font?: PDFFont; color?: RGB; lh?: number } = {}) => {
    const x = o.x ?? M, width = o.width ?? usable, size = o.size ?? 9.2, font = o.font ?? helv, lh = o.lh ?? size * 1.5;
    for (const ln of wrapParas(s, font, size, width)) {
      ensure(lh);
      if (ln) text(ln, x, cur.y, size, font, o.color ?? BODY);
      cur.y -= lh;
    }
  };
  /** A section: its name, a hairline, and a short accent in the brand colour.
   *  `keepWith` is the room its first content needs: a heading never sits
   *  alone at the foot of a page. */
  const sectionTitle = (t: string, keepWith = 0) => {
    ensure(64 + keepWith);
    text(clean(t), M, cur.y, 12, bold, INK);
    const ly = cur.y - 9;
    hairline(ly);
    cur.page.drawRectangle({ x: M, y: ly - 0.9, width: 28, height: 1.8, color: primary });
    cur.y = ly - 21;
  };

  // ── Letterhead ──
  {
    const top = H - 40;
    let leftBottom: number;
    if (logo) {
      const maxH = 44, maxW = 200;
      let dw = (logo.width / logo.height) * maxH, dh = maxH;
      if (dw > maxW) { dw = maxW; dh = (logo.height / logo.width) * maxW; }
      cur.page.drawImage(logo, { x: M, y: top - dh, width: dw, height: dh });
      leftBottom = top - dh;
    } else {
      text(truncate(firm, bold, 15, usable * 0.55), M, top - 15, 15, bold, INK);
      leftBottom = top - 20;
    }
    // Right: who the firm is and how to reach it (the name only when the logo
    // has not already said it).
    const lines: Array<{ t: string; f: PDFFont; s: number; c: RGB }> = [];
    if (logo) lines.push({ t: firm, f: bold, s: 8.6, c: INK });
    lines.push({ t: [TAGLINE, arnNo ? `ARN-${arnNo}` : null].filter(Boolean).join("  |  "), f: helv, s: 7.3, c: MUTED });
    const reach = [brand.phone ? formatPhone(brand.phone) : null, brand.email].filter(Boolean).map((v) => clean(String(v))).join("  |  ");
    if (reach) lines.push({ t: reach, f: helv, s: 7.3, c: MUTED });
    if (brand.website) lines.push({ t: clean(String(brand.website)), f: helv, s: 7.3, c: MUTED });
    let ry = top - 8;
    for (const l of lines) {
      const t = truncate(clean(l.t), l.f, l.s, usable * 0.5);
      text(t, W - M - l.f.widthOfTextAtSize(t, l.s), ry, l.s, l.f, l.c);
      ry -= l.s + 4.6;
    }
    const bottom = Math.min(leftBottom, ry + 3) - 14;
    hairline(bottom);
    cur.page.drawRectangle({ x: M, y: bottom - 0.9, width: 56, height: 1.8, color: primary });
    cur.y = bottom - 34;
  }

  // ── Title and summary ──
  {
    label("Investment proposal", M, cur.y, primary, 7);
    cur.y -= 23;
    const rawTitle = clean(p.title ?? "");
    const generic = !rawTitle || /^investment proposal$/i.test(rawTitle);
    const title = generic ? `Prepared for ${recipient}` : rawTitle;
    for (const ln of wrapParas(title, bold, 20, usable).slice(0, 3)) {
      ensure(26);
      text(ln, M, cur.y, 20, bold, INK);
      cur.y -= 25;
    }
    if (!generic) {
      text(truncate(`Prepared for ${recipient}`, helv, 10.5, usable), M, cur.y + 3, 10.5, helv, BODY);
      cur.y -= 15;
    }
    if (p.summary && p.summary.trim()) {
      cur.y -= 2;
      para(p.summary, { size: 9.6, color: BODY, lh: 14 });
    }
    cur.y -= 8;
  }

  // ── Key facts: reference, dates, proposal risk level ──
  {
    const facts: Array<{ k: string; v: string; lapsed?: boolean }> = [];
    if (ref) facts.push({ k: "Reference", v: `${ref}${n(p.version) && Number(p.version) > 1 ? ` (version ${p.version})` : ""}` });
    facts.push({ k: "Proposal date", v: fmtDate(proposalDate) });
    // A validity date in the past is said, not hidden.
    if (p.validUntil) facts.push({ k: "Valid until", v: fmtDate(p.validUntil), lapsed: istDay(p.validUntil) < istDay(generatedAt) });
    if (p.riskRating) facts.push({ k: "Proposal risk level", v: humanise(p.riskRating) });
    ensure(56);
    const top = cur.y;
    hairline(top);
    // Each cell as wide as its content needs, the rest shared out — a long
    // reference ("... (version 2)") keeps the same size as the other facts.
    const need = facts.map((f) => Math.max(labelWidth(f.k), bold.widthOfTextAtSize(f.v, 9.8) + (f.lapsed ? 46 : 0)) + 22);
    const spare = (usable - need.reduce((a, b) => a + b, 0)) / facts.length;
    const widths = spare >= 0 ? need.map((w) => w + spare) : facts.map(() => usable / facts.length);
    let fx = M;
    facts.forEach((f, i) => {
      const x = fx;
      const cw = widths[i];
      fx += cw;
      label(f.k, x, top - 15);
      const vs = fitText(f.v, bold, 9.8, cw - 14, 7.5);
      text(f.v, x, top - 30, vs, bold, f.lapsed ? RED : INK);
      if (f.lapsed) {
        const chip = "Lapsed";
        const cx = x + bold.widthOfTextAtSize(f.v, vs) + 7;
        const chw = bold.widthOfTextAtSize(chip, 6.5) + 10;
        if (cx + chw < x + cw - 4) {
          cur.page.drawRectangle({ x: cx, y: top - 33, width: chw, height: 11.5, color: RED_BG, borderColor: RED, borderWidth: 0.5 });
          text(chip, cx + 5, top - 29.6, 6.5, bold, RED);
        }
      }
    });
    hairline(top - 41);
    cur.y = top - 41 - 22;
  }

  // ── Client / prepared by ──
  {
    const client = args.client ?? null;
    const riskLine = client?.riskProfile
      ? `Risk profile: ${humanise(client.riskProfile)}${client.riskProfileProvisional ? " (provisional)" : client.riskProfileSignedAt ? `, assessed ${fmtDate(client.riskProfileSignedAt)}` : ""}`
      : null;
    const left = [
      p.recipientPhone ? formatPhone(p.recipientPhone) : null,
      p.recipientEmail ? clean(p.recipientEmail) : null,
      riskLine,
    ].filter(Boolean).map((s) => clean(String(s)));
    const right = [
      prep?.name ? firm : null,
      prep?.euin ? `EUIN ${clean(prep.euin)}` : null,
      prep?.phone || prep?.email
        ? [prep?.phone ? formatPhone(prep.phone) : null, prep?.email].filter(Boolean).map((v) => clean(String(v))).join("  |  ")
        : null,
    ].filter(Boolean).map((s) => clean(String(s)));
    const pad = 15, gap = 30;
    const colW = (usable - 2 * pad - gap) / 2;
    const bodyH = (k: number) => 16 + 15 + k * 12;
    const h = pad + Math.max(bodyH(left.length), bodyH(right.length)) + pad - 8;
    ensure(h + 16);
    const top = cur.y + 4;
    cur.page.drawRectangle({ x: M, y: top - h, width: usable, height: h, color: PANEL });
    const col = (x: number, title: string, name: string, lines: string[]) => {
      let y = top - pad - 6;
      label(title, x, y);
      y -= 17;
      text(truncate(name, bold, 11.5, colW), x, y, 11.5, bold, INK);
      y -= 15;
      for (const l of lines) {
        text(truncate(l, helv, 8.2, colW), x, y, 8.2, helv, BODY);
        y -= 12;
      }
    };
    col(M + pad, "Client", recipient, left);
    cur.page.drawLine({
      start: { x: M + usable / 2, y: top - pad + 2 }, end: { x: M + usable / 2, y: top - h + pad - 2 },
      thickness: 0.6, color: LINE,
    });
    col(M + pad + colW + gap, "Prepared by", clean(prep?.name ?? "") || firm, right);
    cur.y = top - h - 30;
  }

  // ── Cover note — paragraphs kept, flows across pages ──
  if (p.coverLetter && p.coverLetter.trim()) {
    para(p.coverLetter, { size: 9.4, color: BODY, lh: 14 });
    cur.y -= 14;
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
      sectionTitle("At a glance", 66);
      const gap = 10, th = 58;
      const tw = (usable - gap * (tiles.length - 1)) / tiles.length;
      ensure(th + 8);
      const top = cur.y + 8;
      tiles.forEach((t, i) => {
        const x = M + i * (tw + gap);
        cur.page.drawRectangle({ x, y: top - th, width: tw, height: th, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.8 });
        label(t.label, x + 12, top - 16);
        const vs = fitText(t.value, bold, 15, tw - 24, 8);
        text(t.value, x + 12, top - 36, vs, bold, INK);
        if (t.sub) text(t.sub, x + 12, top - 49, 7, helv, MUTED);
      });
      cur.y = top - th - 30;
    }
  }

  // ── Recommendations ──
  const groups: Record<string, any[]> = {};
  for (const it of products) (groups[groupKey(it)] ??= []).push(it);
  const kinds = Object.keys(groups).sort((a, b) => rank(a) - rank(b));
  if (kinds.length) sectionTitle("Recommendations", 80);

  for (const kind of kinds) {
    const items = groups[kind];
    const cols = fitColumns(colsFor(kind), items);
    // Heads wrap onto a second line rather than shrink, so every head is the
    // same size ("ASSUMED RETURN" used to shrink and run into "PROPOSED").
    const HEAD_FS = 6.3, HEAD_LH = 8.4;
    const headLines = cols.map((c) => {
      const room = c.w * usable - 8;
      const out: string[] = [];
      let line = "";
      for (const w of c.h.split(" ")) {
        const trial = line ? `${line} ${w}` : w;
        if (labelWidth(trial, HEAD_FS) <= room || !line) line = trial;
        else { out.push(line); line = w; }
      }
      if (line) out.push(line);
      return out.slice(0, 2);
    });
    const headRows = Math.max(...headLines.map((l) => l.length));
    const drawHead = () => {
      let x = M;
      cols.forEach((c, ci) => {
        const cw = c.w * usable;
        const lines = headLines[ci];
        lines.forEach((ln, k) => {
          // Bottom-aligned on the rule; a word too long for its column shrinks alone.
          let fs = HEAD_FS;
          while (fs > 5 && labelWidth(ln, fs) > cw - 4) fs -= 0.25;
          const y = cur.y - (headRows - lines.length + k) * HEAD_LH;
          label(ln, c.align === "r" ? x + cw - labelWidth(ln, fs) : x, y, MUTED, fs);
        });
        x += cw;
      });
      const ry = cur.y - (headRows - 1) * HEAD_LH - 6;
      hairline(ry, M, M + usable, RULE, 0.9);
      cur.y = ry;
    };
    const groupTitle = (continued: boolean) => {
      text(clean(`${KIND_TITLE[kind] ?? kind}${continued ? " (continued)" : ""}`), M, cur.y, 9.4, bold, primary);
      if (!continued) {
        const count = `${items.length} recommendation${items.length === 1 ? "" : "s"}`;
        text(count, M + usable - helv.widthOfTextAtSize(count, 7.3), cur.y, 7.3, helv, MUTED);
      }
      cur.y -= 17;
    };

    ensure(110);
    groupTitle(false);
    drawHead();

    items.forEach((it) => {
      const nameW = cols[0].w * usable - 12;
      const nameLines = wrapParas(clean(String(cols[0].get(it) ?? "-")), bold, 8.8, nameW).slice(0, 2);
      const metaLines = packParts(subParts(it), helv, 7, nameW).slice(0, 3);
      const note = noteFor(it);
      const noteLines = note ? wrapParas(`Note: ${clean(note)}`, helv, 7.2, usable) : [];
      const otherLines = cols.slice(1).map((c) =>
        c.align === "r" ? 1 : Math.min(3, wrapParas(clean(String(c.get(it) ?? "-")), helv, 8.6, c.w * usable - 10).length));
      // Even padding: 13pt down to the first baseline, ~9pt under the last line.
      const headPart = Math.max(
        13 + (nameLines.length - 1) * 11.5 + (metaLines.length ? 10.5 + (metaLines.length - 1) * 9.5 : 0),
        13 + (Math.max(1, ...otherLines) - 1) * 11,
      );
      const rowH = headPart + (noteLines.length ? 3 + noteLines.length * 9.8 : 0) + 9;
      const before = cur.page;
      ensure(rowH);
      if (cur.page !== before) { groupTitle(true); drawHead(); } // a fresh page repeats the title and heads

      const top = cur.y;
      const firstY = top - 13;
      let x = M;
      cols.forEach((c, ci) => {
        const cw = c.w * usable;
        if (ci === 0) {
          nameLines.forEach((ln, k) => text(ln, x, firstY - k * 11.5, 8.8, bold, INK));
          const metaY = firstY - (nameLines.length - 1) * 11.5 - 10.5;
          metaLines.forEach((parts, k) => drawParts(parts, x, metaY - k * 9.5, 7, helv, MUTED));
        } else {
          const raw = clean(String(c.get(it) ?? "-"));
          const blank = raw === "-";
          // A required amount the RM left blank is said, not dashed.
          const val = blank && c.sum && !c.illus ? "Not specified" : raw;
          if (c.align === "r") {
            // Money is never chopped — "Rs 11,5..." reads as a wrong amount.
            const f = c.illus && !blank ? bold : helv;
            const fs = fitText(val, f, blank ? 7.6 : 8.8, cw - 4, 6);
            text(val, x + cw - f.widthOfTextAtSize(val, fs), firstY, fs, f, blank ? MUTED : INK);
          } else {
            const ls = wrapParas(val, helv, 8.6, cw - 10).slice(0, 3);
            let y = firstY;
            for (const ln of ls) { text(ln, x, y, 8.6, helv, INK); y -= 11; }
          }
        }
        x += cw;
      });
      if (noteLines.length) {
        let y = top - rowH + 9 + (noteLines.length - 1) * 9.8;
        for (const ln of noteLines) { text(ln, M, y, 7.2, helv, BODY); y -= 9.8; }
      }
      hairline(top - rowH, M, M + usable, LINE, 0.6);
      cur.y = top - rowH;
    });

    // Total row — only where there is more than one line to add up.
    if (items.length > 1 && cols.some((c) => c.sum)) {
      ensure(22);
      const top = cur.y;
      hairline(top, M, M + usable, RULE, 0.9);
      let x = M;
      cols.forEach((c, ci) => {
        const cw = c.w * usable;
        if (ci === 0) text("Total", x, top - 13, 8.8, bold, INK);
        else if (c.sum) {
          const total = items.reduce((s, it) => s + (c.sum!(it) ?? 0), 0);
          const val = total ? amt(total) : "";
          const fs = fitText(val, bold, 8.8, cw - 4, 6);
          text(val, x + cw - bold.widthOfTextAtSize(val, fs), top - 13, fs, bold, INK);
        }
        x += cw;
      });
      cur.y = top - 20;
    }
    cur.y -= 24;
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
      sectionTitle("Assumptions and suitability", 30);
      for (const t of notes) bullet(t);
      cur.y -= 10;
    }
  }

  // ── Important disclosures (SEBI / AMFI) — two columns of fine print ──
  {
    if (cur.y - FLOOR < 200) newPage();
    sectionTitle("Important disclosures");
    para("Issued in line with SEBI and AMFI requirements for mutual fund distributors. Please read before you invest.", { size: 7.8, color: MUTED, lh: 11 });
    cur.y -= 8;
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

    // Pour the disclosures into two columns, each one kept whole, balanced on
    // the last page they need. Only a disclosure longer than a whole column
    // (a long firm disclaimer) is split.
    const gap = 22, colW = (usable - gap) / 2, indent = 13;
    const HEAD = 7.6, SMALL = 7.2, LH = 9.9, HEAD_H = 11.5, BETWEEN = 7;
    type Block = { num: string; head: string | null; lines: string[] };
    let blocks: Block[] = items.map(([head, body], k) => ({
      num: `${k + 1}.`, head: clean(head), lines: wrapParas(body, helv, SMALL, colW - indent),
    }));
    const bh = (b: Block) => (b.head ? HEAD_H : 0) + b.lines.length * LH;
    const stackH = (bs: Block[]) => bs.reduce((h, b, k) => h + bh(b) + (k ? BETWEEN : 0), 0);
    const drawBlock = (b: Block, x: number, y: number) => {
      if (b.head) {
        text(b.num, x + indent - 4 - bold.widthOfTextAtSize(b.num, HEAD), y, HEAD, bold, primary);
        text(b.head, x + indent, y, HEAD, bold, INK);
        y -= HEAD_H;
      }
      for (const ln of b.lines) { text(ln, x + indent, y, SMALL, helv, BODY); y -= LH; }
    };
    let guard = 0;
    while (blocks.length && guard++ < 60) {
      const avail = cur.y - FLOOR;
      if (avail < 90) { newPage(); continue; }
      if (bh(blocks[0]) > avail) {
        const fit = Math.max(1, Math.floor((avail - (blocks[0].head ? HEAD_H : 0)) / LH));
        blocks = [
          { ...blocks[0], lines: blocks[0].lines.slice(0, fit) },
          { num: blocks[0].num, head: null, lines: blocks[0].lines.slice(fit) },
          ...blocks.slice(1),
        ];
      }
      // How many blocks the first column takes: the most balanced split when
      // the rest fits on this page, else as many as the column holds.
      const fill = (from: number) => {
        let k = from;
        while (k < blocks.length && stackH(blocks.slice(from, k + 1)) <= avail) k++;
        return k;
      };
      let split = -1;
      if (stackH(blocks) <= 2 * avail) {
        let best = Infinity;
        for (let k = 1; k <= blocks.length; k++) {
          const h1 = stackH(blocks.slice(0, k)), h2 = stackH(blocks.slice(k));
          if (h1 > avail || h2 > avail) continue;
          if (Math.max(h1, h2) < best) { best = Math.max(h1, h2); split = k; }
        }
      }
      if (split < 0) split = Math.max(1, fill(0));
      const end = fill(split);
      const top = cur.y;
      let y = top;
      blocks.slice(0, split).forEach((b) => { drawBlock(b, M, y); y -= bh(b) + BETWEEN; });
      let y2 = top;
      blocks.slice(split, end).forEach((b) => { drawBlock(b, M + colW + gap, y2); y2 -= bh(b) + BETWEEN; });
      cur.y = Math.min(y, y2) + BETWEEN;
      blocks = blocks.slice(end);
      if (blocks.length) newPage();
    }
    cur.y -= 16;
  }

  // ── Acknowledgement and signatures ──
  {
    const h = 104;
    if (cur.y - h - 44 < FLOOR) newPage();
    else cur.y -= 6;
    sectionTitle("Acknowledgement");
    const gap = 30, colW = (usable - gap) / 2;
    const top = cur.y;
    const sigY = top - h + 26;

    // Client
    label("Client", M, top);
    let y = top - 15;
    for (const ln of wrapParas(ACKNOWLEDGEMENT, helv, 7.8, colW)) { text(ln, M, y, 7.8, helv, BODY); y -= 11; }
    hairline(sigY, M, M + colW, MUTED, 0.6);
    text(truncate(`Signature of ${recipient}`, helv, 7.3, colW * 0.62), M, sigY - 11, 7.3, helv, MUTED);
    const dateCap = "Date ______________";
    text(dateCap, M + colW - helv.widthOfTextAtSize(dateCap, 7.3), sigY - 11, 7.3, helv, MUTED);

    // Distributor
    const rx = M + colW + gap;
    label(`For ${firm}`, rx, top, MUTED);
    if (signature) {
      const maxH = 38, maxW = colW;
      let dw = (signature.width / signature.height) * maxH, dh = maxH;
      if (dw > maxW) { dw = maxW; dh = (signature.height / signature.width) * maxW; }
      cur.page.drawImage(signature, { x: rx, y: sigY + 4, width: dw, height: dh });
    }
    hairline(sigY, rx, rx + colW, MUTED, 0.6);
    const who = [clean(prep?.name ?? "") || "Authorised signatory", prep?.euin ? `EUIN ${clean(prep.euin)}` : null].filter(Boolean).join("  |  ");
    text(truncate(who, helv, 7.3, colW), rx, sigY - 11, 7.3, helv, MUTED);
    text(`Dated ${fmtDate(proposalDate)}`, rx, sigY - 22, 7.3, helv, MUTED);
    cur.y = sigY - 34;
  }

  // ── Footer on every page ──
  const pages = doc.getPages();
  pages.forEach((pg, k) => drawFooter(pg, {
    helv, bold, firm, arnNo, brand, refId: p.proposalNumber, page: k + 1, of: pages.length,
  }));

  return Buffer.from(await doc.save());

  /* ── local helpers that draw at the cursor ── */
  function bullet(t: string) {
    const lines = wrapParas(t, helv, 8.2, usable - 14);
    ensure(12);
    cur.page.drawRectangle({ x: M + 1.5, y: cur.y + 2.2, width: 2.8, height: 2.8, color: primary });
    for (const ln of lines) {
      ensure(12);
      text(ln, M + 13, cur.y, 8.2, helv, BODY);
      cur.y -= 12;
    }
    cur.y -= 3;
  }
  /** Facts on one line, separated by small dots. */
  function drawParts(parts: string[], x: number, y: number, size: number, font: PDFFont, color: RGB) {
    let cx = x;
    parts.forEach((part, k) => {
      if (k > 0) {
        cur.page.drawCircle({ x: cx + 5.5, y: y + size * 0.33, size: 0.9, color: FAINT });
        cx += 11;
      }
      text(part, cx, y, size, font, color);
      cx += font.widthOfTextAtSize(part, size);
    });
  }
}

/** Group facts into lines that fit `maxW`, keeping each fact whole. */
function packParts(parts: string[], font: PDFFont, size: number, maxW: number, sep = 11): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  let w = 0;
  for (const raw of parts) {
    const part = truncate(raw, font, size, maxW);
    const pw = font.widthOfTextAtSize(part, size);
    const add = line.length ? sep + pw : pw;
    if (line.length && w + add > maxW) {
      lines.push(line);
      line = [part];
      w = pw;
    } else {
      line.push(part);
      w += add;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/* ── footer ── */
function drawFooter(page: PDFPage, a: {
  helv: PDFFont; bold: PDFFont; firm: string; arnNo: string; brand: ProposalBrand;
  refId?: string | null; page: number; of: number;
}) {
  const W = page.getWidth();
  const usable = W - 2 * M;
  page.drawLine({ start: { x: M, y: 66 }, end: { x: W - M, y: 66 }, thickness: 0.8, color: LINE });
  // A distributor, not an adviser — and the ARN only when there is one
  // (an empty ARN used to print "ARN--").
  const right = [a.refId ? `Ref ${clean(a.refId)}` : null, `Page ${a.page} of ${a.of}`].filter(Boolean).join("  |  ");
  const rw = a.helv.widthOfTextAtSize(right, 7);
  const left = [a.firm, TAGLINE, a.arnNo ? `ARN-${a.arnNo}` : null].filter(Boolean).join("  |  ");
  page.drawText(truncate(left, a.bold, 7.2, usable - rw - 16), { x: M, y: 53, size: 7.2, font: a.bold, color: BODY });
  page.drawText(right, { x: W - M - rw, y: 53, size: 7, font: a.helv, color: MUTED });
  // The AMFI market-risk sentence, always in full — it is the one line that
  // must never be cut.
  let y = 42;
  for (const ln of wrapParas(MANDATORY_RISK_DISCLAIMER, a.helv, 7, usable)) {
    page.drawText(ln, { x: M, y, size: 7, font: a.helv, color: MUTED });
    y -= 9;
  }
  const addr = a.brand.address
    ? [a.brand.address.line1, a.brand.address.line2, a.brand.address.city, a.brand.address.state, a.brand.address.pincode].filter(Boolean).join(", ")
    : "";
  const contact = [addr, a.brand.phone, a.brand.email, a.brand.website].filter(Boolean).map((v) => clean(String(v))).join("  |  ");
  if (contact) page.drawText(truncate(contact, a.helv, 6.6, usable), { x: M, y: y - 1, size: 6.6, font: a.helv, color: FAINT });
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
