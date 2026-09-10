/**
 * Email Designer renderer — turns an EmailDesignerBody into deliverable HTML.
 *
 *   - Uses table-based layout (MJML-style) with inline styles for email clients
 *     that still don't honour external <style> blocks (Gmail mobile, Outlook).
 *   - Substitutes `{{path.to.field}}` merge fields from the supplied variables.
 *   - Wraps every email in a branded shell driven by the theme.
 *   - Auto-appends the SEBI-mandatory footer (ARN, address, unsubscribe) when
 *     enabled.
 *
 * Call `renderEmailHtml(body, ctx)` to produce the final HTML.
 */

import type { EmailDesignerBody, EmailTheme, EmailBlock, EmailFooter } from "./types";
import { absoluteEmailUrl } from "@/lib/comms/email-logo";

export interface RenderContext {
  /** Variables for merge-field substitution. Nested paths supported. */
  variables: Record<string, unknown>;
  /** Tenant info — used by the auto-footer when no logo/address provided. */
  tenant?: {
    legalName?: string | null;
    displayName?: string | null;
    arn?: string | null;
    principalEuin?: string | null;
    address?: string | null;
    websiteUrl?: string | null;
    brandColor?: string | null;
    logoUrl?: string | null;
  };
  /** Optional unsubscribe URL — when set, replaces `{{unsubscribe_url}}`. */
  unsubscribeUrl?: string;
  /** When true (actual send), unresolved `{{fields}}` render as blank instead of
   *  staying visible. The designer PREVIEW leaves this false so the author can see
   *  which fields are still unfilled. */
  blankUnresolved?: boolean;
  /** Designer-only: wrap each block in `<div id="eb-<blockId>">` so the live
   *  preview can scroll the edited block into view. Never set on a real send. */
  previewMarkers?: boolean;
}

const FONT_STACKS: Record<string, string> = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  modern: "Inter, 'Helvetica Neue', Arial, sans-serif",
  rounded: "'SF Pro Rounded', 'Nunito', 'Quicksand', sans-serif",
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function renderEmailHtml(body: EmailDesignerBody, ctx: RenderContext): string {
  if (body.mode === "html") {
    return substituteVariables(body.html ?? "", ctx);
  }

  const theme = resolveTheme(body.theme, ctx.tenant);
  const blocks = body.blocks ?? [];
  const footer = body.footer ?? { includeArn: true, includeAddress: true, includeUnsubscribe: true };

  // Every email should lead with the firm's logo. If this template has no logo
  // block, auto-prepend one from the theme/tenant logo so nothing ships unbranded.
  // The masthead below carries the logo, so a logo block in the body would
  // print it twice. The block still controls height/align — it is the masthead's
  // settings, not a second image.
  const logoBlock = blocks.find((b) => (b as any)?.type === "logo") as any;
  const bodyBlocks = blocks.filter((b) => (b as any)?.type !== "logo");
  const mastheadHtml = renderMasthead(logoBlock, theme, ctx);
  const inner = bodyBlocks
    .map((b) => {
      const rendered = renderBlock(b, theme, ctx);
      return ctx.previewMarkers ? `<div id="eb-${escape(String((b as any).id ?? ""))}">${rendered}</div>` : rendered;
    })
    .join("");
  const footerHtml = renderFooter(footer, theme, ctx);
  const subject = substituteVariables(body.subject ?? "", ctx);
  const preheader = substituteVariables(body.preheader ?? "", ctx);

  const fontStack = FONT_STACKS[theme.fontFamily] ?? FONT_STACKS.sans;

  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>`,
    `<title>${escape(subject)}</title>`,
    `<style>body{margin:0;padding:0;background:${theme.pageBackground};font-family:${fontStack};color:${theme.textColor};} a{color:${theme.brandColor};} .email-card{max-width:${theme.containerWidth}px;margin:0 auto;background:${theme.cardBackground};border-radius:${theme.cornerRadius}px;overflow:hidden;}</style>`,
    `</head>`,
    `<body style="margin:0;padding:0;background:${theme.pageBackground};font-family:${fontStack};color:${theme.textColor};font-size:${theme.baseFontSize}px;line-height:1.55;">`,
    preheader
      ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escape(preheader)}</div>`
      : "",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.pageBackground};">`,
    `<tr><td align="center" style="padding:24px 12px;">`,
    `<table role="presentation" class="email-card" width="${theme.containerWidth}" cellpadding="0" cellspacing="0" border="0" style="background:${theme.cardBackground};border-radius:${theme.cornerRadius}px;overflow:hidden;max-width:${theme.containerWidth}px;width:100%;box-shadow:0 1px 2px rgba(16,24,40,.06);">`,
    mastheadHtml,
    `<tr><td style="padding:30px 32px 26px;">`,
    inner,
    `</td></tr>`,
    footerHtml,
    `</table>`,
    `<div style="margin-top:16px;font-size:11px;line-height:1.5;color:${theme.mutedColor};max-width:${theme.containerWidth}px;text-align:center;">If you have any questions, simply reply to this email.</div>`,
    `</td></tr></table>`,
    `</body></html>`,
  ].join("");
}

/** Plain-text fallback for accessibility / non-HTML clients. */
export function renderEmailText(body: EmailDesignerBody, ctx: RenderContext): string {
  if (body.textFallback && body.textFallback.trim()) {
    return substituteVariables(body.textFallback, ctx);
  }
  if (body.mode === "html") {
    return stripHtml(substituteVariables(body.html ?? "", ctx));
  }
  const parts: string[] = [];
  if (body.preheader) parts.push(substituteVariables(body.preheader, ctx));
  for (const b of body.blocks ?? []) {
    const txt = blockToText(b);
    if (txt) parts.push(substituteVariables(txt, ctx));
  }
  // Append the footer text (ARN + disclaimer + firm) so the plain-text body —
  // and therefore the compliance gate that reads it — carries the mandatory
  // ARN/disclaimer the HTML footer adds. Without this, every templated email
  // fails the SEBI ARN check (the ARN lives only in the HTML footer).
  const footerTxt = footerToText(body.footer, ctx);
  if (footerTxt) parts.push(footerTxt);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Block renderers
// ---------------------------------------------------------------------------

function renderBlock(block: EmailBlock, theme: EmailTheme, ctx: RenderContext): string {
  switch (block.type) {
    case "logo":
      return renderLogo(block, theme, ctx);
    case "signature":
      return renderSignature(block, theme, ctx);
    case "hero":
      return renderHero(block, theme, ctx);
    case "heading":
      return renderHeading(block, theme, ctx);
    case "text":
      return renderText(block, theme, ctx);
    case "button":
      return renderButton(block, theme, ctx);
    case "image":
      return renderImage(block, theme, ctx);
    case "image_row":
      return renderImageRow(block, theme, ctx);
    case "data_table":
      return renderDataTable(block, theme, ctx);
    case "divider":
      return renderDivider(block, theme);
    case "spacer":
      return `<div style="height:${block.height}px;line-height:${block.height}px;">&nbsp;</div>`;
    case "quote":
      return renderQuote(block, theme, ctx);
    case "social":
      return renderSocial(block, theme, ctx);
    case "html":
      return substituteVariables(block.html ?? "", ctx);
    default:
      return "";
  }
}

/**
 * Branded masthead row at the top of the card: the firm's logo on a tinted
 * band, closed by a brand-coloured rule.
 *
 * Every email gets one. Previously the logo simply floated in the body padding
 * (and was absent entirely for a firm with no logo on file), so a client's first
 * impression was an unbranded wall of text. When there is no logo image, the
 * firm's NAME is set in the band instead, so identity is never missing.
 */
function renderMasthead(logoBlock: any, theme: EmailTheme, ctx: RenderContext): string {
  const url = absoluteEmailUrl(theme.logoUrl || ctx.tenant?.logoUrl || "");
  const align = logoBlock?.align || theme.logoAlign || "center";
  const firm = ctx.tenant?.displayName || ctx.tenant?.legalName || "";
  const band = tint(theme.brandColor, 0.045);

  let mark: string;
  if (url) {
    const h = Number(logoBlock?.height) || theme.logoHeight || 56;
    mark = `<img src="${escape(url)}" alt="${escape(firm || "Logo")}" height="${h}" style="height:${h}px;max-height:${h}px;width:auto;max-width:100%;display:inline-block;border:0;"/>`;
  } else if (firm) {
    mark = `<span style="font-size:19px;font-weight:700;letter-spacing:-.2px;color:${theme.accentColor};">${escape(firm)}</span>`;
  } else {
    return "";
  }

  const arn = ctx.tenant?.arn ? arnDisplay(ctx.tenant.arn) : "";
  const sub = arn
    ? `<div style="margin-top:6px;font-size:11px;letter-spacing:.3px;color:${theme.mutedColor};">AMFI Registered Mutual Fund Distributor &nbsp;&middot;&nbsp; ${escape(arn)}</div>`
    : "";

  return `<tr><td style="padding:22px 32px 18px;background:${band};border-bottom:3px solid ${theme.brandColor};text-align:${align};">${mark}${sub}</td></tr>`;
}

function renderLogo(b: any, theme: EmailTheme, ctx: RenderContext): string {
  const url = absoluteEmailUrl(theme.logoUrl || ctx.tenant?.logoUrl || "");
  if (!url) return "";
  // A logo block may override the theme for this one email.
  return logoImgHtml(url, theme, ctx, b?.height, b?.align);
}

/**
 * One logo <img> for both paths.
 *
 * `max-width:100%` + `width:auto` matter: only the HEIGHT is set, so a wide
 * banner logo scaled to that height would otherwise run past the 600px email
 * container and get clipped by the mail client.
 */
function logoImgHtml(
  url: string,
  theme: EmailTheme,
  ctx: RenderContext,
  heightOverride?: number,
  alignOverride?: string
): string {
  const h = Number(heightOverride) || theme.logoHeight || 56;
  const align = alignOverride || theme.logoAlign || "center";
  const alt = escape(ctx.tenant?.displayName ?? "Logo");
  return `<div style="text-align:${align};margin-bottom:18px;"><img src="${escape(url)}" alt="${alt}" height="${h}" style="height:${h}px;max-height:${h}px;width:auto;max-width:100%;display:inline-block;"/></div>`;
}

/**
 * Sender sign-off. Reads the per-send `investor.rm_*` tokens the comms pipeline
 * fills from the client's relationship manager, so the same block signs as
 * whoever owns the client. Any missing line is dropped rather than left blank.
 */
function renderSignature(b: any, theme: EmailTheme, ctx: RenderContext): string {
  const v = (path: string): string => {
    const raw = readPath({ ...ctx.variables, tenant: ctx.tenant }, path);
    return raw === undefined || raw === null ? "" : String(raw).trim();
  };

  const align = b.align === "center" ? "center" : "left";
  const name = v("investor.rm_name") || v("lead.owner_name");
  // AMFI/SEBI: a distributor's client-facing sign-off states the REGISTRATION,
  // not an internal department. "Advisory" in particular reads as investment
  // advice, which an AMFI-registered distributor is not authorised to give
  // (advice is incidental to distribution). An explicit override still wins.
  const designation =
    b.showDesignation === false ? "" : (b.designation as string) || "AMFI Registered Mutual Fund Distributor";
  const email = b.showContact === false ? "" : v("investor.rm_email");
  const phone = b.showContact === false ? "" : v("investor.rm_phone");
  const sigUrl = b.showSignatureImage === false ? "" : absoluteEmailUrl(v("investor.rm_signature_url"));
  const firmName = ctx.tenant?.displayName || ctx.tenant?.legalName || "";
  const arn = ctx.tenant?.arn ? arnDisplay(ctx.tenant.arn) : "";

  const parts: string[] = [];
  if (b.closing) {
    parts.push(
      `<div style="margin:0 0 6px;color:${theme.textColor};font-size:${theme.baseFontSize}px;">${escape(
        substituteVariables(b.closing, ctx)
      )}</div>`
    );
  }
  if (sigUrl) {
    const h = Number(b.signatureHeight) || 56;
    parts.push(
      `<div style="margin:0 0 4px;"><img src="${escape(sigUrl)}" alt="${escape(
        name ? `${name} signature` : "Signature"
      )}" height="${h}" style="height:${h}px;max-height:${h}px;display:inline-block;"/></div>`
    );
  }
  if (name) {
    parts.push(
      `<div style="font-weight:700;color:${theme.accentColor};font-size:${theme.baseFontSize}px;">${escape(name)}</div>`
    );
  }
  if (designation) {
    parts.push(`<div style="color:${theme.mutedColor};font-size:13px;">${escape(designation)}</div>`);
  }
  const contact = [phone, email].filter(Boolean);
  if (contact.length) {
    // Link the address/number so a client can act from the signature itself.
    const bits = [
      phone ? `<a href="tel:${escape(phone.replace(/[^+\d]/g, ""))}" style="color:${theme.mutedColor};text-decoration:none;">${escape(phone)}</a>` : "",
      email ? `<a href="mailto:${escape(email)}" style="color:${theme.mutedColor};text-decoration:none;">${escape(email)}</a>` : "",
    ].filter(Boolean);
    parts.push(`<div style="color:${theme.mutedColor};font-size:13px;margin-top:2px;">${bits.join(" &nbsp;·&nbsp; ")}</div>`);
  }
  if (b.showFirm !== false && firmName) {
    parts.push(
      `<div style="color:${theme.mutedColor};font-size:13px;margin-top:6px;">${escape(firmName)}${
        arn ? ` &nbsp;·&nbsp; ${escape(arn)}` : ""
      }</div>`
    );
  }
  if (!parts.length) return "";
  return `<div style="margin:22px 0 6px;text-align:${align};line-height:1.5;">${parts.join("")}</div>`;
}

function renderHero(b: any, theme: EmailTheme, ctx: RenderContext): string {
  const titleHtml = escape(substituteVariables(b.title ?? "", ctx));
  const subHtml = escape(substituteVariables(b.subtitle ?? "", ctx));
  const img = b.imageUrl ? `<img src="${escape(b.imageUrl)}" alt="${escape(b.imageAlt ?? "")}" style="max-width:100%;border-radius:8px;margin-bottom:18px;display:block;"/>` : "";
  return `<div style="text-align:${b.align};margin-bottom:24px;">${img}<h1 style="font-size:26px;line-height:1.25;color:${theme.accentColor};margin:0 0 8px;font-weight:700;">${titleHtml}</h1>${subHtml ? `<p style="margin:0;color:${theme.mutedColor};font-size:15px;">${subHtml}</p>` : ""}</div>`;
}

function renderHeading(b: any, theme: EmailTheme, ctx: RenderContext): string {
  const tag = b.level;
  // h3 is used as a SECTION heading inside a message, so it needs more air above
  // than below — it belongs to the text that follows it, not the block before.
  const size = b.level === "h1" ? 25 : b.level === "h2" ? 20 : 15;
  const margin = b.level === "h3" ? "26px 0 8px" : "22px 0 12px";
  const spacing = b.level === "h3" ? "letter-spacing:.1px;" : "letter-spacing:-.2px;";
  return `<${tag} style="font-size:${size}px;color:${theme.accentColor};margin:${margin};text-align:${b.align};font-weight:700;line-height:1.32;${spacing}">${escape(substituteVariables(b.text ?? "", ctx))}</${tag}>`;
}

function renderText(b: any, theme: EmailTheme, ctx: RenderContext): string {
  const html = substituteVariables(b.html ?? "", ctx, /* htmlEscapeValues */ true);
  // "note" = small print (disclaimers, link caveats). Set at body size it
  // competed with the message; it now reads as a footnote, separated by a rule.
  if (b.variant === "note") {
    return `<div style="margin:18px 0 0;padding-top:12px;border-top:1px solid ${tint(theme.mutedColor, 0.35)};text-align:${b.align};font-size:11.5px;line-height:1.55;color:${theme.mutedColor};">${html}</div>`;
  }
  return `<div style="margin:0 0 15px;text-align:${b.align};font-size:${theme.baseFontSize}px;line-height:1.62;color:${theme.textColor};">${html}</div>`;
}

function renderButton(b: any, theme: EmailTheme, ctx: RenderContext): string {
  const label = substituteVariables(b.label ?? "Click", ctx);
  const url = substituteVariables(b.url ?? "#", ctx);
  const solid = b.style !== "outline";
  const bg = solid ? theme.brandColor : "transparent";
  const color = solid ? "#ffffff" : theme.brandColor;
  const border = solid ? theme.brandColor : theme.brandColor;
  const width = b.fullWidth ? "width:100%;" : "";
  // Solid buttons take a 1px same-colour border so the hit area matches the
  // outline variant exactly; a 2px border made solid buttons visibly chunkier.
  const bw = solid ? 1 : 2;
  return `<div style="text-align:${b.align};margin:24px 0;">
<a href="${escape(url)}" style="${width}display:inline-block;background:${bg};color:${color};border:${bw}px solid ${border};border-radius:8px;padding:13px 28px;font-weight:600;text-decoration:none;font-size:14.5px;line-height:1.2;letter-spacing:.2px;">${label}</a>
</div>`;
}

function renderImage(b: any, theme: EmailTheme, ctx: RenderContext): string {
  if (!b.url) return "";
  const url = substituteVariables(b.url, ctx);
  const img = `<img src="${escape(url)}" alt="${escape(b.alt ?? "")}" width="${b.width}" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:0 auto;"/>`;
  const link = b.linkUrl ? `<a href="${escape(substituteVariables(b.linkUrl, ctx))}">${img}</a>` : img;
  return `<div style="text-align:${b.align};margin:14px 0;">${link}</div>`;
}

function renderImageRow(b: any, _theme: EmailTheme, ctx: RenderContext): string {
  const items = b.items ?? [];
  if (!items.length) return "";
  const cellWidth = Math.floor(100 / items.length);
  const cells = items
    .map((it: any) => {
      const img = `<img src="${escape(substituteVariables(it.url ?? "", ctx))}" alt="${escape(it.alt ?? "")}" style="max-width:100%;height:auto;border-radius:6px;display:block;"/>`;
      const wrapped = it.linkUrl ? `<a href="${escape(substituteVariables(it.linkUrl, ctx))}">${img}</a>` : img;
      return `<td valign="top" style="padding:0 6px;width:${cellWidth}%;">${wrapped}</td>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;"><tr>${cells}</tr></table>`;
}

function renderDataTable(b: any, theme: EmailTheme, ctx: RenderContext): string {
  const caption = substituteVariables(b.caption ?? "", ctx);
  const all = (b.rows ?? []) as any[];
  const rows = all
    .map((r: any, i: number) => {
      const last = i === all.length - 1;
      return `<tr><td style="padding:11px 16px;color:${theme.mutedColor};font-size:13px;${last ? "" : `border-bottom:1px solid ${tint(theme.mutedColor, 0.28)};`}width:44%;vertical-align:top;">${escape(substituteVariables(r.label ?? "", ctx))}</td><td style="padding:11px 16px;font-weight:600;font-size:14px;color:${theme.textColor};${last ? "" : `border-bottom:1px solid ${tint(theme.mutedColor, 0.28)};`}vertical-align:top;">${escape(substituteVariables(r.value ?? "", ctx))}</td></tr>`;
    })
    .join("");
  // The caption becomes a proper header strip rather than a floating line, so
  // the block reads as one panel instead of a stray label above a grid.
  const head = caption
    ? `<tr><td colspan="2" style="padding:11px 16px;background:${tint(theme.brandColor, 0.07)};font-weight:700;font-size:12px;letter-spacing:.4px;text-transform:uppercase;color:${theme.accentColor};border-bottom:1px solid ${tint(theme.brandColor, 0.22)};">${caption}</td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;border:1px solid ${tint(theme.mutedColor, 0.3)};border-radius:10px;overflow:hidden;background:#ffffff;">${head}${rows}</table>`;
}

function renderDivider(b: any, _theme: EmailTheme): string {
  return `<hr style="border:0;border-top:${b.thickness}px solid ${b.color};margin:18px 0;"/>`;
}

function renderQuote(b: any, theme: EmailTheme, ctx: RenderContext): string {
  return `<blockquote style="margin:18px 0;padding:14px 18px;border-left:3px solid ${theme.brandColor};background:#f9fafb;color:${theme.textColor};font-style:italic;border-radius:0 6px 6px 0;">"${escape(substituteVariables(b.text ?? "", ctx))}"${b.author ? `<div style="margin-top:6px;font-style:normal;color:${theme.mutedColor};font-size:13px;">— ${escape(substituteVariables(b.author, ctx))}</div>` : ""}</blockquote>`;
}

function renderSocial(b: any, theme: EmailTheme, ctx: RenderContext): string {
  const links = b.links ?? {};
  const items: string[] = [];
  const ICON: Record<string, string> = {
    website: "🌐",
    linkedin: "in",
    facebook: "f",
    instagram: "ig",
    youtube: "yt",
    twitter: "x",
  };
  for (const [k, v] of Object.entries(links)) {
    if (!v || !String(v).trim()) continue;
    const url = substituteVariables(String(v), ctx);
    items.push(
      `<a href="${escape(url)}" style="display:inline-block;width:34px;height:34px;line-height:34px;border-radius:50%;background:${theme.brandColor};color:#fff;text-align:center;text-decoration:none;font-size:12px;font-weight:700;margin:0 3px;">${ICON[k] ?? k.slice(0, 2)}</a>`
    );
  }
  if (!items.length) return "";
  return `<div style="text-align:center;margin:18px 0;">${items.join("")}</div>`;
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

/** "ARN-249212" from a value stored either with or without the prefix. */
function arnDisplay(arn?: string | null): string {
  if (!arn) return "";
  return `ARN-${String(arn).replace(/^arn[\s-]*/i, "")}`;
}

/**
 * Plain-text version of the footer (firm · ARN · EUIN + the mandatory MF risk
 * line). Mirrors renderFooter so the TEXT body carries the same ARN/disclaimer
 * the HTML does — critical because the compliance gate reads the text, and the
 * SEBI ARN + AMFI disclaimer requirements are satisfied by THIS footer.
 */
export function footerToText(footer: EmailFooter | undefined, ctx: RenderContext): string {
  if (!footer) return "";
  const t = ctx.tenant ?? {};
  const lines: string[] = [];
  if (footer.customText) lines.push(substituteVariables(footer.customText, ctx));
  if (footer.includeArn && (t.arn || t.principalEuin)) {
    const arn = arnDisplay(t.arn);
    const euin = t.principalEuin ? ` · EUIN ${t.principalEuin}` : "";
    lines.push(`${t.displayName ?? t.legalName ?? ""}${arn ? ` · ${arn}` : ""}${euin}`.trim());
  }
  if (footer.includeAddress && t.address) lines.push(String(t.address));
  lines.push("Mutual fund investments are subject to market risks. Please read the scheme information document carefully before investing.");
  return lines.filter(Boolean).join("\n");
}

function renderFooter(footer: EmailFooter, theme: EmailTheme, ctx: RenderContext): string {
  const lines: string[] = [];
  const t = ctx.tenant ?? {};
  if (footer.customText) lines.push(escape(substituteVariables(footer.customText, ctx)));
  if (footer.includeArn && (t.arn || t.principalEuin)) {
    const arn = arnDisplay(t.arn);
    const euin = t.principalEuin ? ` · EUIN ${t.principalEuin}` : "";
    lines.push(`${escape(t.displayName ?? t.legalName ?? "")} · ${arn}${euin}`);
  }
  if (footer.includeAddress && t.address) lines.push(escape(t.address));
  if (lines.length === 0 && !footer.includeUnsubscribe) return "";
  const unsubscribe = footer.includeUnsubscribe
    ? `<div style="margin-top:8px;"><a href="${escape(ctx.unsubscribeUrl ?? "{{unsubscribe_url}}")}" style="color:${theme.mutedColor};text-decoration:underline;">Unsubscribe</a></div>`
    : "";
  return `<tr><td style="padding:18px 28px 28px;background:#fafbfd;border-top:1px solid #eef0f4;font-size:11px;color:${theme.mutedColor};text-align:center;line-height:1.6;">${lines.map((l) => `<div>${l}</div>`).join("")}<div style="margin-top:6px;">Mutual fund investments are subject to market risks. Please read the scheme information document carefully before investing.</div>${unsubscribe}</td></tr>`;
}

// ---------------------------------------------------------------------------
// Theme defaults
// ---------------------------------------------------------------------------

function resolveTheme(theme: EmailTheme | undefined, tenant: RenderContext["tenant"]): EmailTheme {
  const base: EmailTheme = {
    logoUrl: tenant?.logoUrl ?? undefined,
    logoHeight: 56,
    logoAlign: "center",
    brandColor: tenant?.brandColor ?? "#0ea5e9",
    accentColor: "#0e2557",
    pageBackground: "#f5f7fb",
    cardBackground: "#ffffff",
    textColor: "#111827",
    mutedColor: "#6b7280",
    fontFamily: "sans",
    baseFontSize: 15,
    containerWidth: 600,
    cornerRadius: 12,
  };
  return { ...base, ...(theme ?? {}) };
}

// ---------------------------------------------------------------------------
// Merge field substitution: `{{path.to.value}}`
// ---------------------------------------------------------------------------

const MERGE_FIELD_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Base app URL for resolving link tokens that must never be empty. */
const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://crm.ainatech.in"
).replace(/\/+$/, "");

export function substituteVariables(input: string, ctx: RenderContext, htmlEscapeValues = false): string {
  if (!input) return "";
  return input.replace(MERGE_FIELD_RE, (full, path: string) => {
    const v = readPath({ ...ctx.variables, tenant: ctx.tenant }, path);
    if (v === undefined || v === null) {
      if (!ctx.blankUnresolved) return full; // preview: keep the token visible
      // On SEND, a URL token that resolved to nothing would produce a dead/blank
      // button href. Give known link tokens a safe, working fallback so every
      // button lands somewhere: the firm's site (client CTAs) → the app.
      if (path === "system.dashboard_url") return `${APP_URL}/dashboard`;
      if (path === "tenant.websiteUrl") return ctx.tenant?.websiteUrl || APP_URL;
      if (path === "system.unsubscribe_url" || path === "unsubscribe_url") return ctx.unsubscribeUrl || "#";
      return ""; // other unresolved fields blank out as before
    }
    let out: string;
    if (typeof v === "string") out = v;
    else if (typeof v === "number" || typeof v === "boolean") out = String(v);
    else if (v instanceof Date) out = v.toLocaleDateString("en-IN");
    else out = String(v);
    // In rich-text/HTML blocks the author's markup is the TEMPLATE (trusted) but
    // the resolved merge VALUE is attacker-influenced (e.g. an investor name) —
    // escape it so a name like `<script>` can't inject. Plain-text contexts pass
    // htmlEscapeValues=false (escaping the whole output happens at the sink).
    return htmlEscapeValues ? escape(out) : out;
  });
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

/**
 * Mix a hex colour toward white by `amount` (0 = white, 1 = the colour).
 * Email clients cannot be relied on for rgba(), so tints are pre-computed.
 */
function tint(hex: string | undefined, amount: number): string {
  const m = String(hex ?? "").replace(/^#/, "").match(/^([0-9a-fA-F]{6})$/);
  if (!m) return "#e5e7eb";
  const [r, g, b] = (m[1].match(/.{2}/g) as string[]).map((x) => parseInt(x, 16));
  const mix = (c: number) => Math.round(255 - (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function escape(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTML block content -> plain text for the text/plain alternative.
 *
 * Stripping every tag outright ran sentences together: "Dear Anil,<br><br>Thank
 * you" came out as "Dear Anil,Thank you". That alternative is what some mail
 * clients display, what screen readers read, and what spam filters score, so it
 * has to read as prose. Breaks and block ends become newlines, list items
 * become dashes, and the few entities the designer emits are decoded.
 */
function stripHtml(s: string): string {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|ul|ol)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function blockToText(b: EmailBlock): string {
  switch (b.type) {
    case "hero":
      return `${(b as any).title}\n${(b as any).subtitle ?? ""}`;
    case "heading":
      return (b as any).text;
    case "text":
      return stripHtml((b as any).html);
    case "button":
      return `${(b as any).label}: ${(b as any).url}`;
    case "quote":
      return `"${(b as any).text}" ${(b as any).author ? `— ${(b as any).author}` : ""}`;
    case "data_table":
      return ((b as any).rows as { label: string; value: string }[]).map((r) => `${r.label}: ${r.value}`).join("\n");
    case "html":
      return stripHtml((b as any).html ?? "");
    default:
      return "";
  }
}
