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
    // ── SPLIT: a letterhead look — branded header (logo card + firm name +
    //    web) on top, and a structured identity + contact bar on the bottom.
    const topH = Math.max(56, Math.round(H * 0.1));
    const bottomH = stripH;

    const topSvg = buildHeaderStripSvg(W, topH, primary, accent, tenant, !!logoCircleBuf);
    const topPng = await sharp(Buffer.from(topSvg)).png().toBuffer();
    overlays.push({ input: topPng, top: 0, left: 0 });
    if (logoCircleBuf) {
      // Inset the logo inside a white rounded card (drawn by the header SVG)
      // so transparent logos always sit on a clean, professional chip.
      const padding = Math.round(topH * 0.17);
      const tile = topH - 2 * padding;
      const inset = Math.round(tile * 0.12);
      const inner = Math.max(8, tile - 2 * inset);
      const resized = await sharp(logoCircleBuf)
        .resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
      overlays.push({ input: resized, top: padding + inset, left: padding + inset });
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
  const padding = Math.round(H * 0.17);
  const tile = H - 2 * padding;
  const textX = padding + tile + Math.round(H * 0.14);
  const rx = Math.round(tile * 0.2);

  const firmFont = Math.max(15, Math.round(tile * 0.44));
  const rawName = tenant.displayName ?? tenant.legalName ?? "MFD";
  const darkerPrimary = shadeHex(primary, -14);
  const stripeH = Math.max(3, Math.round(H * 0.06));
  const initial = rawName.charAt(0).toUpperCase();

  // Right-aligned secondary: the website if we have one, otherwise a small
  // credibility label. Sized so it never crowds the firm name.
  const websiteRaw = tenant.website
    ? tenant.website.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : "";
  const isLabel = !websiteRaw;
  const rightText = websiteRaw || "AMFI-REGISTERED MFD";
  const rightFont = Math.max(10, Math.round(tile * (isLabel ? 0.22 : 0.28)));
  const rightW = rightText.length * rightFont * (isLabel ? 0.66 : 0.56);

  // Truncate the firm name to the space left of the secondary text.
  const nameAvail = W - padding - Math.round(W * 0.03) - rightW - textX;
  const nameMaxChars = Math.max(6, Math.floor(nameAvail / (firmFont * 0.56)));
  const displayName = escapeXml(truncate(rawName, nameMaxChars));

  const yName = Math.round(H / 2 + firmFont * 0.34);

  // White rounded chip behind the logo (or the initial when no logo).
  const logoChip = hasLogo
    ? `<rect x="${padding}" y="${padding}" width="${tile}" height="${tile}" rx="${rx}" fill="white" />`
    : `<g>
        <rect x="${padding}" y="${padding}" width="${tile}" height="${tile}" rx="${rx}" fill="white" />
        <text x="${padding + tile / 2}" y="${padding + tile / 2}" fill="${primary}" font-family="Inter, system-ui, sans-serif" font-size="${Math.round(
        tile * 0.5
      )}" font-weight="800" text-anchor="middle" dominant-baseline="central">${escapeXml(initial)}</text>
      </g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgH" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${darkerPrimary}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgH)" />
  <rect x="0" y="${H - stripeH}" width="${W}" height="${stripeH}" fill="${accent}" />
  ${logoChip}
  <text x="${textX}" y="${yName}" fill="white" font-family="Inter, system-ui, sans-serif" font-size="${firmFont}" font-weight="700" letter-spacing="0.2">${displayName}</text>
  <text x="${W - padding}" y="${yName}" fill="rgba(255,255,255,${isLabel ? "0.68" : "0.88"})" font-family="Inter, system-ui, sans-serif" font-size="${rightFont}" font-weight="${isLabel ? "600" : "500"}" text-anchor="end"${isLabel ? ' letter-spacing="1.4"' : ""}>${escapeXml(rightText)}</text>
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
  const padding = Math.round(H * 0.16);
  const innerH = H - 2 * padding;
  const darkerPrimary = shadeHex(primary, -14);
  const stripeH = Math.max(3, Math.round(H * 0.03));
  const accentBarW = Math.max(3, Math.round(W * 0.004));

  // ── Identity (left): a slim accent bar, the ARN, and a credibility label.
  const idX = padding + accentBarW + Math.round(padding * 0.8);
  const arnFont = Math.max(16, Math.round(innerH * 0.3));
  const labelFont = Math.max(9, Math.round(innerH * 0.12));
  const arnText = `ARN-${(tenant.arn ?? "—").toString().replace(/^ARN-?/i, "")}`;
  const arnY = padding + Math.round(arnFont * 0.92);
  const labelY = arnY + Math.round(labelFont * 1.9);

  // ── Contacts (right): icon + value rows.
  const items: { icon: string; text: string }[] = [];
  if (tenant.phone) items.push({ icon: "phone", text: String(tenant.phone) });
  if (tenant.email) items.push({ icon: "mail", text: String(tenant.email) });
  if (tenant.website)
    items.push({ icon: "globe", text: tenant.website.replace(/^https?:\/\//, "").replace(/\/+$/, "") });
  if (tenant.address) {
    const a: any = tenant.address;
    const addr =
      typeof a === "string"
        ? a
        : [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ");
    if (addr) items.push({ icon: "pin", text: addr });
  }

  const hasContacts = items.length > 0;
  const leftColW = hasContacts ? Math.round(W * 0.4) : W - 2 * padding;
  const dividerX = padding + leftColW;
  const rcX = hasContacts ? dividerX + Math.round(padding * 1.1) : idX;
  const rcW = W - padding - rcX;

  // Credibility label, truncated so it never collides with the divider.
  const labelMaxChars = Math.max(
    6,
    Math.floor((dividerX - idX - Math.round(padding * 0.6)) / (labelFont * 0.66))
  );
  const idLabel = escapeXml(truncate("AMFI-REGISTERED DISTRIBUTOR", labelMaxChars));

  const contactFont = Math.max(11, Math.round(innerH * 0.155));
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
  <g transform="translate(${rcX}, ${iconY}) scale(${(iconSize / 24).toFixed(3)})" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${featherIcon(
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgD" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${darkerPrimary}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgD)" />
  <rect x="0" y="0" width="${W}" height="${stripeH}" fill="${accent}" />
  <rect x="${padding}" y="${padding}" width="${accentBarW}" height="${innerH}" rx="${accentBarW / 2}" fill="${accent}" />
  <text x="${idX}" y="${arnY}" fill="white" font-family="ui-monospace, Menlo, monospace" font-size="${arnFont}" font-weight="700" letter-spacing="0.5">${escapeXml(
    arnText
  )}</text>
  <text x="${idX}" y="${labelY}" fill="rgba(255,255,255,0.6)" font-family="Inter, system-ui, sans-serif" font-size="${labelFont}" font-weight="600" letter-spacing="1.1">${idLabel}</text>
  ${divider}
  ${rowsSvg}
</svg>`;
}

/* ─────────────────── Helpers ─────────────────── */

/** Single-line truncation with an ellipsis so long names/values never overflow. */
function truncate(s: string, maxChars: number): string {
  if (!s) return "";
  return s.length <= maxChars ? s : s.slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
}

/** Minimal monoline (Feather-style) icon paths for the split contact rows. */
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
