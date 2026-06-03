/**
 * Server-side image co-branding.
 *
 * Pulls a source image from S3 (or any URL), composites a branded footer
 * strip (firm name + ARN + contact + the mandatory MF disclaimer + logo),
 * returns a PNG buffer.
 *
 * The raw S3 URL is never exposed to MFD browsers — the only way they can
 * obtain the image is via /api/content-library/[id]/branded, which always
 * stamps their tenant's branding onto it.
 *
 * Design notes (why it looks the way it does):
 *   - The logo sits on a WHITE ROUNDED CARD sized to the logo's real aspect
 *     ratio, so a wide wordmark ("WE CARE …") gets a wide card instead of
 *     being letter-boxed into an ugly square.
 *   - Contact rows use clean monoline (Feather) icons, never emoji — emoji
 *     render inconsistently across servers and read as amateur.
 *   - Every layout carries the SEBI/AMFI mutual-fund disclaimer in a slim
 *     sub-band. This is a compliance requirement for MFD marketing creatives,
 *     not a cosmetic nicety.
 */

import sharp from "sharp";

/** Mandatory mutual-fund risk disclaimer for Indian MFD marketing material. */
export const MF_DISCLAIMER =
  "Mutual Fund investments are subject to market risks, read all scheme related documents carefully.";

export type BrandingTenant = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: any | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
};

export type BrandingPosition = "top" | "bottom" | "both" | "split";

/**
 * Branding layout options:
 *   - bottom: single strip at the bottom (default; everything bundled)
 *   - top:    single strip at the top
 *   - both:   same single strip duplicated top + bottom
 *   - split:  thin top header (logo + firm name) + bottom strip (ARN +
 *             contact + address). The "logo on top, details on bottom" mode.
 */
export type BrandingConfig = {
  position?: BrandingPosition;
  heightPct?: number;
  background?: string;
};

/** A logo fetched + decoded, plus its aspect ratio for card sizing. */
type PreparedLogo = { data: Buffer; aspect: number };

/**
 * Render a co-branded PNG.
 *
 *   - `sourceBuffer` is the raw image bytes (any format sharp supports).
 *   - `tenant` is the MFD's branding info (snapshot — no DB calls inside).
 *   - `config` is per-asset overrides (position / height / bg).
 *
 * Returns a PNG Buffer.
 */
export async function composeBrandedImage(
  sourceBuffer: Buffer,
  tenant: BrandingTenant,
  config: BrandingConfig = {}
): Promise<Buffer> {
  const position = config.position ?? "bottom";
  const heightPct = clamp(config.heightPct ?? 18, 8, 30);

  // Load source + read dimensions
  const base = sharp(sourceBuffer, { failOn: "none" });
  const meta = await base.metadata();
  const W = meta.width ?? 1200;
  const H = meta.height ?? 800;
  const stripH = Math.round((H * heightPct) / 100);

  const primary = sanitizeColor(config.background ?? tenant.primaryColor ?? "#0e2557");
  // Brand-cohesive accent: a lightened tint of the firm's own colour, so the
  // hairline never clashes the way a fixed cyan did on a warm-coloured brand.
  const accent = shadeHex(primary, 34);

  const logo = await prepareLogo(tenant.logoUrl);
  const overlays: sharp.OverlayOptions[] = [];

  if (position === "split") {
    // ── SPLIT: letterhead look — branded header (logo card + firm name +
    //    website) on top, structured identity + contact bar (+ disclaimer)
    //    on the bottom.
    const topH = Math.max(64, Math.round(H * 0.1));
    const bottomH = stripH;

    const hg = headerGeom(W, topH, logo?.aspect ?? null);
    const topSvg = buildHeaderStripSvg(W, topH, primary, accent, tenant, hg, !!logo);
    overlays.push({ input: await svgToPng(topSvg), top: 0, left: 0 });
    if (logo) {
      const fitted = await fitLogo(logo, hg.cardW, hg.cardH, Math.round(hg.cardH * 0.14));
      overlays.push({
        input: fitted.buf,
        top: hg.cardY + Math.round((hg.cardH - fitted.h) / 2),
        left: hg.cardX + Math.round((hg.cardW - fitted.w) / 2),
      });
    }

    const bottomSvg = buildDetailsStripSvg(W, bottomH, primary, accent, tenant);
    overlays.push({ input: await svgToPng(bottomSvg), top: H - bottomH, left: 0 });
  } else {
    // Single combined strip (bottom / top / both).
    const geom = stripGeom(W, stripH, logo?.aspect ?? null);
    const stripSvg = buildStripSvg(W, stripH, primary, accent, tenant, geom, !!logo);
    const stripPng = await svgToPng(stripSvg);

    let fitted: { buf: Buffer; w: number; h: number } | null = null;
    if (logo) {
      fitted = await fitLogo(logo, geom.cardW, geom.cardH, Math.round(geom.cardH * 0.16));
    }
    const placeLogo = (stripTop: number) => {
      if (!fitted) return;
      overlays.push({
        input: fitted.buf,
        top: stripTop + geom.cardY + Math.round((geom.cardH - fitted.h) / 2),
        left: geom.cardX + Math.round((geom.cardW - fitted.w) / 2),
      });
    };

    if (position === "bottom" || position === "both") {
      overlays.push({ input: stripPng, top: H - stripH, left: 0 });
      placeLogo(H - stripH);
    }
    if (position === "top" || position === "both") {
      overlays.push({ input: stripPng, top: 0, left: 0 });
      placeLogo(0);
    }
  }

  return base.composite(overlays).png().toBuffer();
}

/* ─────────────────── Logo preparation ─────────────────── */

/** Fetch + decode the tenant logo, returning the bytes and its aspect ratio. */
async function prepareLogo(url?: string | null): Promise<PreparedLogo | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = Buffer.from(await r.arrayBuffer());
    const m = await sharp(data).metadata();
    const w = m.width ?? 1;
    const h = m.height ?? 1;
    return { data, aspect: w / h };
  } catch {
    return null;
  }
}

/**
 * Resize the logo to fit *inside* a card's inner area, preserving aspect and
 * keeping transparency (the white card is drawn by the SVG behind it). Returns
 * the rendered buffer plus its real dimensions so the caller can centre it.
 */
async function fitLogo(
  logo: PreparedLogo,
  cardW: number,
  cardH: number,
  innerPad: number
): Promise<{ buf: Buffer; w: number; h: number }> {
  const maxW = Math.max(8, cardW - 2 * innerPad);
  const maxH = Math.max(8, cardH - 2 * innerPad);
  const buf = await sharp(logo.data)
    .resize(maxW, maxH, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const m = await sharp(buf).metadata();
  return { buf, w: m.width ?? maxW, h: m.height ?? maxH };
}

async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/* ─────────────────── Single strip (bottom / top / both) ─────────────────── */

type StripGeom = {
  disclaimerH: number;
  mainH: number;
  cardH: number;
  cardW: number;
  cardX: number;
  cardY: number;
  rx: number;
  textX: number;
  textW: number;
};

/** Compute the geometry once so the SVG and the logo composite agree. */
function stripGeom(W: number, stripH: number, aspect: number | null): StripGeom {
  const disclaimerH = clamp(Math.round(stripH * 0.2), 16, 46);
  const mainH = stripH - disclaimerH;
  const vpad = Math.round(mainH * 0.16);
  const cardH = Math.max(12, mainH - 2 * vpad);
  const cardX = Math.max(Math.round(W * 0.02), vpad);
  const cardW =
    aspect != null
      ? clamp(Math.round(cardH * aspect), Math.round(cardH * 0.7), Math.round(W * 0.34))
      : cardH;
  const cardY = vpad;
  const rx = Math.round(Math.min(cardW, cardH) * 0.16);
  const textX = cardX + cardW + Math.round(mainH * 0.16);
  const textW = Math.max(40, W - textX - Math.round(W * 0.03));
  return { disclaimerH, mainH, cardH, cardW, cardX, cardY, rx, textX, textW };
}

function buildStripSvg(
  W: number,
  stripH: number,
  primary: string,
  accent: string,
  tenant: BrandingTenant,
  geom: StripGeom,
  hasLogo: boolean
): string {
  const { disclaimerH, mainH, cardH, cardW, cardX, cardY, rx, textX, textW } = geom;
  const darker = shadeHex(primary, -14);
  const bandBg = shadeHex(primary, -24);
  const accentH = Math.max(3, Math.round(stripH * 0.022));

  const titleF = clamp(Math.round(mainH * 0.3), 14, 40);
  const arnF = clamp(Math.round(mainH * 0.17), 11, 22);
  const contactF = clamp(Math.round(mainH * 0.165), 11, 20);

  const rawName = tenant.displayName ?? tenant.legalName ?? "MFD";
  const nameMax = Math.max(6, Math.floor(textW / (titleF * 0.56)));
  const displayName = escapeXml(truncate(rawName, nameMax));
  const arnText = `ARN ${(tenant.arn ?? "—").toString().replace(/^ARN-?/i, "")}`;

  const yTitle = cardY + Math.round(titleF * 0.92);
  const yArn = yTitle + Math.round(arnF * 1.4);
  const yContact = Math.min(mainH - Math.round(contactF * 0.45), yArn + Math.round(contactF * 1.7));

  const rowSvg = contactRowSvg(contactItems(tenant), textX, yContact, textW, contactF);

  // Logo card (white, rounded). When there's no logo we draw the firm initial.
  const initial = rawName.charAt(0).toUpperCase();
  const cardSvg =
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${rx}" fill="#ffffff" />` +
    (hasLogo
      ? ""
      : `<text x="${cardX + cardW / 2}" y="${cardY + cardH / 2}" fill="${primary}" font-family="Inter, system-ui, sans-serif" font-size="${Math.round(
          cardH * 0.52
        )}" font-weight="800" text-anchor="middle" dominant-baseline="central">${escapeXml(
          initial
        )}</text>`);

  // Disclaimer sub-band.
  const bandTop = stripH - disclaimerH;
  const discMaxW = W - 2 * cardX;
  let discF = clamp(Math.round(disclaimerH * 0.42), 8, 15);
  if (MF_DISCLAIMER.length * discF * 0.5 > discMaxW) {
    discF = Math.max(7, Math.floor(discMaxW / (MF_DISCLAIMER.length * 0.5)));
  }
  const discY = bandTop + Math.round(disclaimerH / 2 + discF * 0.36);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${stripH}" viewBox="0 0 ${W} ${stripH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0.6">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${darker}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${stripH}" fill="url(#bg)" />
  <rect x="0" y="0" width="${W}" height="${accentH}" fill="${accent}" />
  ${cardSvg}
  <text x="${textX}" y="${yTitle}" fill="#ffffff" font-family="Inter, system-ui, sans-serif" font-size="${titleF}" font-weight="700" letter-spacing="0.2">${displayName}</text>
  <text x="${textX}" y="${yArn}" fill="${accent}" font-family="ui-monospace, Menlo, monospace" font-size="${arnF}" font-weight="700" letter-spacing="0.6">${escapeXml(
    arnText
  )}</text>
  ${rowSvg}
  <rect x="0" y="${bandTop}" width="${W}" height="${disclaimerH}" fill="${bandBg}" />
  <rect x="0" y="${bandTop}" width="${W}" height="1" fill="rgba(255,255,255,0.12)" />
  <text x="${W / 2}" y="${discY}" fill="rgba(255,255,255,0.82)" font-family="Inter, system-ui, sans-serif" font-size="${discF}" font-weight="500" letter-spacing="0.2" text-anchor="middle">${escapeXml(
    MF_DISCLAIMER
  )}</text>
</svg>`;
}

/* ─────────────────── Split-layout: thin header (logo + name) ─────────────────── */

type HeaderGeom = { cardW: number; cardH: number; cardX: number; cardY: number; rx: number; textX: number };

function headerGeom(W: number, H: number, aspect: number | null): HeaderGeom {
  const padding = Math.round(H * 0.17);
  const cardH = H - 2 * padding;
  const cardW =
    aspect != null
      ? clamp(Math.round(cardH * aspect), Math.round(cardH * 0.7), Math.round(W * 0.3))
      : cardH;
  const cardX = padding;
  const cardY = padding;
  const rx = Math.round(Math.min(cardW, cardH) * 0.2);
  const textX = cardX + cardW + Math.round(H * 0.14);
  return { cardW, cardH, cardX, cardY, rx, textX };
}

function buildHeaderStripSvg(
  W: number,
  H: number,
  primary: string,
  accent: string,
  tenant: BrandingTenant,
  geom: HeaderGeom,
  hasLogo: boolean
): string {
  const { cardW, cardH, cardX, cardY, rx, textX } = geom;
  const padding = Math.round(H * 0.17);

  const firmFont = Math.max(15, Math.round(cardH * 0.44));
  const rawName = tenant.displayName ?? tenant.legalName ?? "MFD";
  const darker = shadeHex(primary, -16);
  const stripeH = Math.max(3, Math.round(H * 0.06));
  const initial = rawName.charAt(0).toUpperCase();

  // Right-aligned secondary: the website if we have one, else a credibility tag.
  const websiteRaw = tenant.website
    ? tenant.website.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : "";
  const isLabel = !websiteRaw;
  const rightText = websiteRaw || "AMFI-REGISTERED MFD";
  const rightFont = Math.max(10, Math.round(cardH * (isLabel ? 0.22 : 0.28)));
  const rightW = rightText.length * rightFont * (isLabel ? 0.66 : 0.56);

  const nameAvail = W - padding - Math.round(W * 0.03) - rightW - textX;
  const nameMaxChars = Math.max(6, Math.floor(nameAvail / (firmFont * 0.56)));
  const displayName = escapeXml(truncate(rawName, nameMaxChars));

  const yName = Math.round(H / 2 + firmFont * 0.34);

  const logoChip =
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${rx}" fill="#ffffff" />` +
    (hasLogo
      ? ""
      : `<text x="${cardX + cardW / 2}" y="${cardY + cardH / 2}" fill="${primary}" font-family="Inter, system-ui, sans-serif" font-size="${Math.round(
          cardH * 0.5
        )}" font-weight="800" text-anchor="middle" dominant-baseline="central">${escapeXml(
          initial
        )}</text>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgH" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${darker}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgH)" />
  <rect x="0" y="${H - stripeH}" width="${W}" height="${stripeH}" fill="${accent}" />
  ${logoChip}
  <text x="${textX}" y="${yName}" fill="#ffffff" font-family="Inter, system-ui, sans-serif" font-size="${firmFont}" font-weight="700" letter-spacing="0.2">${displayName}</text>
  <text x="${W - padding}" y="${yName}" fill="rgba(255,255,255,${isLabel ? "0.7" : "0.9"})" font-family="Inter, system-ui, sans-serif" font-size="${rightFont}" font-weight="${isLabel ? "600" : "500"}" text-anchor="end"${isLabel ? ' letter-spacing="1.4"' : ""}>${escapeXml(
    rightText
  )}</text>
</svg>`;
}

/* ─────────────────── Split-layout: details strip (no logo) ─────────────────── */

function buildDetailsStripSvg(
  W: number,
  H: number,
  primary: string,
  accent: string,
  tenant: BrandingTenant
): string {
  const disclaimerH = clamp(Math.round(H * 0.18), 16, 44);
  const contentH = H - disclaimerH;
  const padding = Math.round(contentH * 0.16);
  const innerH = contentH - 2 * padding;
  const darker = shadeHex(primary, -14);
  const bandBg = shadeHex(primary, -24);
  const stripeH = Math.max(3, Math.round(H * 0.03));
  const accentBarW = Math.max(3, Math.round(W * 0.004));

  // ── Identity (left): a slim accent bar, the ARN, and a credibility label.
  const idX = padding + accentBarW + Math.round(padding * 0.8);
  const arnFont = clamp(Math.round(innerH * 0.3), 16, 34);
  const labelFont = Math.max(9, Math.round(innerH * 0.12));
  const arnText = `ARN-${(tenant.arn ?? "—").toString().replace(/^ARN-?/i, "")}`;
  const arnY = padding + Math.round(arnFont * 0.92);
  const labelY = arnY + Math.round(labelFont * 1.9);

  const items = contactItems(tenant);
  const hasContacts = items.length > 0;
  const leftColW = hasContacts ? Math.round(W * 0.4) : W - 2 * padding;
  const dividerX = padding + leftColW;
  const rcX = hasContacts ? dividerX + Math.round(padding * 1.1) : idX;
  const rcW = W - padding - rcX;

  const labelMaxChars = Math.max(
    6,
    Math.floor((dividerX - idX - Math.round(padding * 0.6)) / (labelFont * 0.66))
  );
  const idLabel = escapeXml(truncate("AMFI-REGISTERED MUTUAL FUND DISTRIBUTOR", labelMaxChars));

  const contactFont = clamp(Math.round(innerH * 0.155), 11, 18);
  const iconSize = Math.round(contactFont * 1.15);
  const gap = Math.round(contactFont * 0.6);
  const rowH = Math.round(contactFont * 1.95);
  const maxRows = Math.max(1, Math.floor((innerH + rowH * 0.2) / rowH));
  const shown = items.slice(0, Math.min(items.length, maxRows, 4));
  const blockH = shown.length * rowH;
  const startY = padding + Math.round((innerH - blockH) / 2);
  const charPx = contactFont * 0.55;
  const maxChars = Math.max(10, Math.floor((rcW - iconSize - gap) / charPx));

  const rowsSvg = shown
    .map((it, i) => {
      const baseY = startY + i * rowH + Math.round(rowH * 0.66);
      const iconY = baseY - Math.round(iconSize * 0.82);
      const text = escapeXml(truncate(it.text, maxChars));
      return `
  <g transform="translate(${rcX}, ${iconY}) scale(${(iconSize / 24).toFixed(
        3
      )})" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${featherIcon(
        it.icon
      )}</g>
  <text x="${rcX + iconSize + gap}" y="${baseY}" fill="rgba(255,255,255,0.94)" font-family="Inter, system-ui, sans-serif" font-size="${contactFont}" font-weight="500">${text}</text>`;
    })
    .join("");

  const divider = hasContacts
    ? `<line x1="${dividerX}" y1="${padding + Math.round(innerH * 0.16)}" x2="${dividerX}" y2="${
        padding + Math.round(innerH * 0.84)
      }" stroke="rgba(255,255,255,0.18)" stroke-width="1.5" />`
    : "";

  // Disclaimer sub-band.
  const bandTop = H - disclaimerH;
  const discMaxW = W - 2 * padding;
  let discF = clamp(Math.round(disclaimerH * 0.42), 8, 15);
  if (MF_DISCLAIMER.length * discF * 0.5 > discMaxW) {
    discF = Math.max(7, Math.floor(discMaxW / (MF_DISCLAIMER.length * 0.5)));
  }
  const discY = bandTop + Math.round(disclaimerH / 2 + discF * 0.36);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgD" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${darker}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgD)" />
  <rect x="0" y="0" width="${W}" height="${stripeH}" fill="${accent}" />
  <rect x="${padding}" y="${padding}" width="${accentBarW}" height="${innerH}" rx="${
    accentBarW / 2
  }" fill="${accent}" />
  <text x="${idX}" y="${arnY}" fill="#ffffff" font-family="ui-monospace, Menlo, monospace" font-size="${arnFont}" font-weight="700" letter-spacing="0.5">${escapeXml(
    arnText
  )}</text>
  <text x="${idX}" y="${labelY}" fill="rgba(255,255,255,0.6)" font-family="Inter, system-ui, sans-serif" font-size="${labelFont}" font-weight="600" letter-spacing="1.1">${idLabel}</text>
  ${divider}
  ${rowsSvg}
  <rect x="0" y="${bandTop}" width="${W}" height="${disclaimerH}" fill="${bandBg}" />
  <rect x="0" y="${bandTop}" width="${W}" height="1" fill="rgba(255,255,255,0.12)" />
  <text x="${W / 2}" y="${discY}" fill="rgba(255,255,255,0.82)" font-family="Inter, system-ui, sans-serif" font-size="${discF}" font-weight="500" letter-spacing="0.2" text-anchor="middle">${escapeXml(
    MF_DISCLAIMER
  )}</text>
</svg>`;
}

/* ─────────────────── Contact helpers ─────────────────── */

/** Ordered contact items (phone → website → email → address) with icon keys. */
function contactItems(tenant: BrandingTenant): { icon: string; text: string }[] {
  const items: { icon: string; text: string }[] = [];
  if (tenant.phone) items.push({ icon: "phone", text: String(tenant.phone) });
  if (tenant.website)
    items.push({ icon: "globe", text: tenant.website.replace(/^https?:\/\//, "").replace(/\/+$/, "") });
  if (tenant.email) items.push({ icon: "mail", text: String(tenant.email) });
  if (tenant.address) {
    const a: any = tenant.address;
    const addr =
      typeof a === "string"
        ? a
        : [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ");
    if (addr) items.push({ icon: "pin", text: addr });
  }
  return items;
}

/**
 * Lay contact items left-to-right on a single baseline, each preceded by a
 * monoline icon. Items that don't fit the available width are dropped; the
 * last fitting item is truncated to the remaining space.
 */
function contactRowSvg(
  items: { icon: string; text: string }[],
  startX: number,
  baselineY: number,
  availW: number,
  font: number
): string {
  if (!items.length) return "";
  const iconSize = Math.round(font * 1.05);
  const gap = Math.round(font * 0.42);
  const spacing = Math.round(font * 1.5);
  const charPx = font * 0.56;
  const limit = startX + availW;

  let x = startX;
  const out: string[] = [];
  for (const it of items) {
    const afterIcon = x + iconSize + gap;
    // Need room for at least the icon + a few chars to bother rendering.
    if (out.length > 0 && afterIcon + 4 * charPx > limit) break;
    const maxChars = Math.max(4, Math.floor((limit - afterIcon) / charPx));
    const shown = truncate(it.text, Math.min(maxChars, 40));
    const iconY = baselineY - Math.round(iconSize * 0.8);
    out.push(
      `<g transform="translate(${x}, ${iconY}) scale(${(iconSize / 24).toFixed(
        3
      )})" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${featherIcon(
        it.icon
      )}</g>`
    );
    out.push(
      `<text x="${afterIcon}" y="${baselineY}" fill="rgba(255,255,255,0.95)" font-family="Inter, system-ui, sans-serif" font-size="${font}" font-weight="500">${escapeXml(
        shown
      )}</text>`
    );
    x = afterIcon + shown.length * charPx + spacing;
    if (x >= limit) break;
  }
  return out.join("");
}

/* ─────────────────── Helpers ─────────────────── */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Single-line truncation with an ellipsis so long names/values never overflow. */
function truncate(s: string, maxChars: number): string {
  if (!s) return "";
  return s.length <= maxChars ? s : s.slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
}

/** Minimal monoline (Feather-style) icon paths for the contact rows. */
function featherIcon(type: string): string {
  switch (type) {
    case "phone":
      return `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />`;
    case "mail":
      return `<rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" />`;
    case "globe":
      return `<circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />`;
    case "pin":
      return `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />`;
    default:
      return "";
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeColor(c: string): string {
  return /^#?[0-9a-fA-F]{6}$/.test(c.replace(/^#/, "")) ? (c.startsWith("#") ? c : "#" + c) : "#0e2557";
}

function shadeHex(hex: string, pct: number): string {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return hex;
  const [r, g, b] = m.map((x) => parseInt(x, 16));
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
  return `#${[f(r), f(g), f(b)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
