/**
 * Server-side image co-branding.
 *
 * Pulls a source image from S3 (or any URL), composites a branded footer
 * strip (firm name + ARN + contact + address + logo), returns a PNG buffer.
 *
 * The raw S3 URL is never exposed to MFD browsers — the only way they can
 * obtain the image is via /api/content-library/[id]/branded, which always
 * stamps their tenant's branding onto it.
 */

import sharp from "sharp";

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
  const heightPct = Math.max(8, Math.min(30, config.heightPct ?? 18));

  // Load source + read dimensions
  const base = sharp(sourceBuffer, { failOn: "none" });
  const meta = await base.metadata();
  const W = meta.width ?? 1200;
  const H = meta.height ?? 800;
  const stripH = Math.round((H * heightPct) / 100);

  const primary = sanitizeColor(config.background ?? tenant.primaryColor ?? "#0e2557");
  const accent = "#0ea5e9";

  // ─── Optional tenant logo (best-effort fetch + decode to PNG buffer) ───
  let logoCircleBuf: Buffer | null = null;
  if (tenant.logoUrl) {
    try {
      const r = await fetch(tenant.logoUrl);
      if (r.ok) {
        const ab = await r.arrayBuffer();
        const tileSide = Math.round(stripH * 0.72);
        logoCircleBuf = await sharp(Buffer.from(ab))
          .resize(tileSide, tileSide, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
          .png()
          .toBuffer();
      }
    } catch {
      logoCircleBuf = null;
    }
  }

  // Layer builders — handle each layout shape
  const overlays: sharp.OverlayOptions[] = [];

  if (position === "split") {
    // ── SPLIT: thin top (logo + firm name) + bottom (ARN + contact + address)
    const topH = Math.max(36, Math.round(H * 0.07)); // ~7 % header
    const bottomH = stripH;

    const topSvg = buildHeaderStripSvg(W, topH, primary, accent, tenant, !!logoCircleBuf);
    const topPng = await sharp(Buffer.from(topSvg)).png().toBuffer();
    overlays.push({ input: topPng, top: 0, left: 0 });
    if (logoCircleBuf) {
      const tile = Math.round(topH * 0.72);
      const padding = Math.round(topH * 0.14);
      const resized = await sharp(logoCircleBuf)
        .resize(tile, tile, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
      overlays.push({ input: resized, top: padding, left: padding });
    }

    const bottomSvg = buildDetailsStripSvg(W, bottomH, primary, accent, tenant);
    const bottomPng = await sharp(Buffer.from(bottomSvg)).png().toBuffer();
    overlays.push({ input: bottomPng, top: H - bottomH, left: 0 });
  } else {
    // Single combined strip — original behavior
    const stripSvg = buildStripSvg(W, stripH, primary, accent, tenant, !!logoCircleBuf);
    const stripPng = await sharp(Buffer.from(stripSvg)).png().toBuffer();
    const tile = Math.round(stripH * 0.72);
    const padding = Math.round(stripH * 0.14);

    if (position === "bottom" || position === "both") {
      overlays.push({ input: stripPng, top: H - stripH, left: 0 });
      if (logoCircleBuf) {
        overlays.push({ input: logoCircleBuf, top: H - stripH + padding, left: padding });
      }
    }
    if (position === "top" || position === "both") {
      overlays.push({ input: stripPng, top: 0, left: 0 });
      if (logoCircleBuf) {
        overlays.push({ input: logoCircleBuf, top: padding, left: padding });
      }
    }
  }

  return base.composite(overlays).png().toBuffer();
}

/* ─────────────────── SVG strip ─────────────────── */

function buildStripSvg(
  W: number,
  H: number,
  primary: string,
  accent: string,
  tenant: BrandingTenant,
  hasLogo: boolean
): string {
  const padding = Math.round(H * 0.14);
  const innerH = H - 2 * padding;
  const tile = Math.round(innerH);

  // Text-column geometry: leave room for the logo tile if present, else use a
  // placeholder initial tile rendered in the SVG itself.
  const textX = padding + tile + padding;
  const textW = W - textX - padding;

  const titleFont = Math.max(14, Math.round(innerH * 0.32));
  const arnFont = Math.max(11, Math.round(innerH * 0.18));
  const contactFont = Math.max(11, Math.round(innerH * 0.16));

  // Lines
  const displayName = escapeXml(tenant.displayName ?? tenant.legalName ?? "MFD");
  const arnRaw = (tenant.arn ?? "—").toString();
  const arn = `ARN ${escapeXml(arnRaw.replace(/^ARN-?/i, ""))}`;
  const contactPieces: string[] = [];
  if (tenant.phone) contactPieces.push("☎ " + tenant.phone);
  if (tenant.email) contactPieces.push("✉ " + tenant.email);
  if (tenant.website) contactPieces.push("🌐 " + tenant.website.replace(/^https?:\/\//, ""));
  if (tenant.address) {
    const a: any = tenant.address;
    const addressStr =
      typeof a === "string"
        ? a
        : [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ");
    if (addressStr) contactPieces.push("📍 " + addressStr);
  }
  // Server-side text wrapping using a rough character-pixel ratio.
  const charPx = contactFont * 0.55;
  const maxChars = Math.max(20, Math.floor(textW / charPx));
  const contactLines = wrapPieces(contactPieces, maxChars).slice(0, 2);

  // Initial tile (shown only when there's no real logo — sharp draws the real
  // logo on top via composite, but we still render the tile background here
  // so the layout stays consistent).
  const initial = (tenant.displayName ?? tenant.legalName ?? "M").charAt(0).toUpperCase();

  const darkerPrimary = shadeHex(primary, -12);
  const stripeH = Math.max(3, Math.round(H * 0.03));

  // Compute y baselines
  const yTitle = padding + titleFont * 0.95;
  const yArn = yTitle + arnFont * 1.05;
  const yContact1 = yArn + contactFont * 1.6;
  const yContact2 = yContact1 + contactFont * 1.3;

  const contactSvg = contactLines
    .map(
      (line, i) =>
        `<text x="${textX}" y="${i === 0 ? yContact1 : yContact2}" fill="rgba(255,255,255,0.92)" font-family="Inter, system-ui, sans-serif" font-size="${contactFont}" font-weight="500">${escapeXml(
          line
        )}</text>`
    )
    .join("");

  // Logo placeholder (will be visually replaced by the real logo composite
  // when available — but if not, this initial tile is what the user sees).
  const logoTile = hasLogo
    ? ""
    : `<g>
        <rect x="${padding}" y="${padding}" width="${tile}" height="${tile}" rx="${Math.round(
        tile * 0.18
      )}" fill="white" />
        <text x="${padding + tile / 2}" y="${padding + tile / 2}" fill="${primary}" font-family="Inter, system-ui, sans-serif" font-size="${Math.round(
        tile * 0.55
      )}" font-weight="800" text-anchor="middle" dominant-baseline="central">${escapeXml(initial)}</text>
      </g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${darkerPrimary}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bg)" />
  <rect x="0" y="0" width="${W}" height="${stripeH}" fill="${accent}" />
  ${logoTile}
  <text x="${textX}" y="${yTitle}" fill="white" font-family="Inter, system-ui, sans-serif" font-size="${titleFont}" font-weight="700">${displayName}</text>
  <text x="${textX}" y="${yArn}" fill="rgba(255,255,255,0.78)" font-family="ui-monospace, Menlo, monospace" font-size="${arnFont}" font-weight="500">${arn}</text>
  ${contactSvg}
</svg>`;
}

/* ─────────────────── Split-layout: thin header (logo + name) ─────────────────── */

function buildHeaderStripSvg(
  W: number,
  H: number,
  primary: string,
  accent: string,
  tenant: BrandingTenant,
  hasLogo: boolean
): string {
  const padding = Math.round(H * 0.14);
  const tile = H - 2 * padding;
  const textX = padding + tile + padding;
  const textW = W - textX - padding;

  const titleFont = Math.max(13, Math.round((H - 2 * padding) * 0.5));
  const subFont = Math.max(10, Math.round((H - 2 * padding) * 0.3));
  const displayName = escapeXml(tenant.displayName ?? tenant.legalName ?? "MFD");
  const tagline = tenant.arn ? `ARN ${(tenant.arn ?? "").replace(/^ARN-?/i, "")}` : "";
  const darkerPrimary = shadeHex(primary, -12);
  const stripeH = Math.max(2, Math.round(H * 0.04));
  const initial = (tenant.displayName ?? tenant.legalName ?? "M").charAt(0).toUpperCase();

  const logoPlaceholder = hasLogo
    ? ""
    : `<g>
        <rect x="${padding}" y="${padding}" width="${tile}" height="${tile}" rx="${Math.round(
        tile * 0.18
      )}" fill="white" />
        <text x="${padding + tile / 2}" y="${padding + tile / 2}" fill="${primary}" font-family="Inter, system-ui, sans-serif" font-size="${Math.round(
        tile * 0.55
      )}" font-weight="800" text-anchor="middle" dominant-baseline="central">${escapeXml(initial)}</text>
      </g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgH" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${darkerPrimary}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgH)" />
  <rect x="0" y="${H - stripeH}" width="${W}" height="${stripeH}" fill="${accent}" />
  ${logoPlaceholder}
  <text x="${textX}" y="${padding + titleFont * 0.95}" fill="white" font-family="Inter, system-ui, sans-serif" font-size="${titleFont}" font-weight="700">${displayName}</text>
  ${
    tagline
      ? `<text x="${textX}" y="${padding + titleFont * 0.95 + subFont * 1.2}" fill="rgba(255,255,255,0.75)" font-family="ui-monospace, Menlo, monospace" font-size="${subFont}" font-weight="500">${escapeXml(
          tagline
        )}</text>`
      : ""
  }
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
  const padding = Math.round(H * 0.14);
  const innerH = H - 2 * padding;
  const arnFont = Math.max(13, Math.round(innerH * 0.22));
  const contactFont = Math.max(11, Math.round(innerH * 0.18));
  const darkerPrimary = shadeHex(primary, -12);
  const stripeH = Math.max(3, Math.round(H * 0.03));

  const arnLine = `ARN ${escapeXml((tenant.arn ?? "—").toString().replace(/^ARN-?/i, ""))}`;
  const contactPieces: string[] = [];
  if (tenant.phone) contactPieces.push("☎ " + tenant.phone);
  if (tenant.email) contactPieces.push("✉ " + tenant.email);
  if (tenant.website) contactPieces.push("🌐 " + tenant.website.replace(/^https?:\/\//, ""));
  if (tenant.address) {
    const a: any = tenant.address;
    const addressStr =
      typeof a === "string"
        ? a
        : [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ");
    if (addressStr) contactPieces.push("📍 " + addressStr);
  }
  const charPx = contactFont * 0.55;
  const maxChars = Math.max(20, Math.floor((W - 2 * padding) / charPx));
  const contactLines = wrapPieces(contactPieces, maxChars).slice(0, 3);

  const yArn = padding + arnFont * 0.95;
  const yContact1 = yArn + contactFont * 1.5;

  const contactSvg = contactLines
    .map(
      (line, i) =>
        `<text x="${padding}" y="${yContact1 + i * contactFont * 1.35}" fill="rgba(255,255,255,0.92)" font-family="Inter, system-ui, sans-serif" font-size="${contactFont}" font-weight="500">${escapeXml(
          line
        )}</text>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgD" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${darkerPrimary}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgD)" />
  <rect x="0" y="0" width="${W}" height="${stripeH}" fill="${accent}" />
  <text x="${padding}" y="${yArn}" fill="white" font-family="ui-monospace, Menlo, monospace" font-size="${arnFont}" font-weight="700">${arnLine}</text>
  ${contactSvg}
</svg>`;
}

/* ─────────────────── Helpers ─────────────────── */

function wrapPieces(pieces: string[], maxChars: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const p of pieces) {
    const trial = current ? `${current}  ·  ${p}` : p;
    if (trial.length <= maxChars) current = trial;
    else {
      if (current) lines.push(current);
      current = p;
    }
  }
  if (current) lines.push(current);
  return lines;
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
