/**
 * The morning briefing email (workers/daily-briefing.ts) — a pure renderer, so
 * it can be tested and previewed without a database.
 *
 * Built from tables with inline styles: Outlook and Gmail ignore <style> blocks,
 * flexbox and most CSS, so this is the only layout that holds in every client.
 * The firm's own name, logo and colour head it; no emoji, because Outlook on
 * Windows draws them as a black-and-white glyph next to a professional body.
 */

import type { ActionGroup, ActionItem } from "@/lib/command-center/queue";

export type BriefingFirm = { name: string; logoUrl?: string | null; color?: string | null };

export type BriefingEmail = { subject: string; html: string; text: string };

/** Summary tiles across the top, and sections in the body. */
const MAX_TILES = 4;
const MAX_SECTIONS = 6;
const ITEMS_PER_SECTION = 3;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#111827";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";
const LINE = "#e5e7eb";

/** The count's ink by the group's tone — the same signal the Command Center uses. */
const TONE_INK: Record<ActionGroup["tone"], string> = {
  rose: "#b42318",
  amber: "#b54708",
  sky: "#175cd3",
  violet: "#6941c6",
  emerald: "#067647",
};

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** A firm colour only when it is a plain hex — it goes into a style attribute. */
function brandColor(c?: string | null): string {
  return c && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : "#1f2937";
}

const absolute = (base: string, href: string) => (/^https?:\/\//i.test(href) ? href : `${base}${href.startsWith("/") ? "" : "/"}${href}`);

/** "Friday, 30 October 2026" in India time. */
export function briefingDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/**
 * A task's detail reads "normal · due 05 Jun 26". Normal priority is the
 * default and says nothing, so it is dropped; any other becomes "High priority".
 */
export function itemMeta(detail?: string): string {
  if (!detail) return "";
  const m = /^(low|normal|high|urgent)\s·\s(.*)$/i.exec(detail.trim());
  const text = m ? (m[1].toLowerCase() === "normal" ? m[2] : `${cap(m[1])} priority · ${m[2]}`) : detail.trim();
  // A part with no value ("Tier —") is a blank field, not information.
  return cap(text.split(" · ").filter((part) => !/\s—$/.test(part.trim())).join(" · "));
}

/** "SLA breached — service requests" → "SLA breached": a tile has room for the gist. */
const tileLabel = (label: string) => label.split(" — ")[0];

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function renderBriefingEmail(args: {
  userName: string;
  firm: BriefingFirm;
  groups: ActionGroup[];
  baseUrl: string;
  now?: Date;
}): BriefingEmail {
  const { firm, baseUrl } = args;
  const groups = args.groups.filter((g) => g.count > 0);
  const total = groups.reduce((n, g) => n + g.count, 0);
  const firstName = (args.userName || "").trim().split(/\s+/)[0] || "there";
  const date = briefingDate(args.now ?? new Date());
  const color = brandColor(firm.color);
  const dashboard = absolute(baseUrl, "/dashboard");

  const subject = `Morning briefing · ${plural(total, "item")} need${total === 1 ? "s" : ""} your attention`;

  // ── Header: logo (or the firm's name) and the date ───────────────────────
  const logo = firm.logoUrl
    ? `<img src="${esc(absolute(baseUrl, firm.logoUrl))}" alt="${esc(firm.name)}" height="32" style="display:block;height:32px;width:auto;max-width:180px;border:0;outline:none;">`
    : `<span style="font-size:16px;font-weight:700;color:${INK};">${esc(firm.name)}</span>`;

  // ── Summary tiles ────────────────────────────────────────────────────────
  const tiles = groups.slice(0, MAX_TILES);
  const tileWidth = Math.floor(100 / Math.max(tiles.length, 1));
  const tileCells = tiles
    .map(
      (g, i) => `<td width="${tileWidth}%" valign="top" style="padding:0 ${i === tiles.length - 1 ? 0 : 8}px 0 0;">
        <table role="presentation" width="100%" height="90" cellpadding="0" cellspacing="0" border="0" style="height:90px;background:#f9fafb;border:1px solid ${LINE};border-radius:8px;">
          <tr><td class="tile" valign="top" style="padding:12px 12px;">
            <div class="num" style="font-size:24px;line-height:28px;font-weight:700;color:${TONE_INK[g.tone] ?? INK};">${g.count}</div>
            <div style="font-size:12px;line-height:16px;color:${MUTED};margin-top:2px;">${esc(tileLabel(g.label))}</div>
          </td></tr>
        </table>
      </td>`
    )
    .join("");

  // ── Sections ─────────────────────────────────────────────────────────────
  const sections = groups
    .slice(0, MAX_SECTIONS)
    .map((g) => {
      const rows = g.items
        .slice(0, ITEMS_PER_SECTION)
        .map((it: ActionItem) => {
          const meta = itemMeta(it.detail);
          return `<tr><td style="padding:10px 0;border-top:1px solid ${LINE};">
            <a href="${esc(absolute(baseUrl, it.href))}" style="font-size:14px;line-height:20px;color:${INK};text-decoration:none;font-weight:500;">${esc(it.title)}</a>
            ${meta ? `<div style="font-size:12px;line-height:18px;color:${MUTED};margin-top:2px;">${esc(meta)}</div>` : ""}
          </td></tr>`;
        })
        .join("");
      const rest = g.count - Math.min(g.items.length, ITEMS_PER_SECTION);
      const more =
        rest > 0
          ? `<tr><td style="padding:10px 0 0;border-top:1px solid ${LINE};">
              <a href="${esc(absolute(baseUrl, g.href))}" style="font-size:13px;color:${color};text-decoration:none;font-weight:600;">View all ${g.count} &rarr;</a>
              <span style="font-size:12px;color:${FAINT};">&nbsp;&nbsp;${rest} more not shown</span>
            </td></tr>`
          : "";
      return `<tr><td class="px" style="padding:24px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:0 0 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="font-size:15px;line-height:20px;font-weight:600;color:${INK};">${esc(g.label)}</td>
              <td align="right" style="white-space:nowrap;">
                <span style="display:inline-block;font-size:12px;line-height:16px;font-weight:600;color:${TONE_INK[g.tone] ?? INK};background:#f3f4f6;border-radius:10px;padding:2px 9px;">${g.count}</span>
              </td>
            </tr></table>
          </td></tr>
          ${rows}${more}
        </table>
      </td></tr>`;
    })
    .join("");

  const hidden = groups.length - Math.min(groups.length, MAX_SECTIONS);
  const hiddenNote = hidden > 0
    ? `<tr><td class="px" style="padding:16px 32px 0;font-size:13px;color:${MUTED};">${plural(hidden, "more list")} on your dashboard.</td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><style>@media (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.tile{padding:10px 8px!important}.num{font-size:20px!important;line-height:24px!important}}</style><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(groups.slice(0, MAX_TILES).map((g) => `${g.count} ${g.label}`).join(" · "))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;font-family:${FONT};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden;">
      <tr><td style="height:4px;line-height:4px;font-size:0;background:${color};">&nbsp;</td></tr>
      <tr><td class="px" style="padding:20px 32px;border-bottom:1px solid ${LINE};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle">${logo}</td>
          <td valign="middle" align="right" style="font-size:12px;line-height:16px;color:${MUTED};">Daily briefing<br><span style="color:${INK};font-weight:600;">${esc(date)}</span></td>
        </tr></table>
      </td></tr>
      <tr><td class="px" style="padding:28px 32px 0;">
        <div style="font-size:22px;line-height:28px;font-weight:700;color:${INK};">Good morning, ${esc(firstName)}</div>
        <div style="font-size:14px;line-height:22px;color:${MUTED};margin-top:6px;">${plural(total, "item")} need${total === 1 ? "s" : ""} your attention today. Here is where to start.</div>
      </td></tr>
      ${tiles.length ? `<tr><td class="px" style="padding:20px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${tileCells}</tr></table>
      </td></tr>` : ""}
      ${sections}
      ${hiddenNote}
      <tr><td class="px" style="padding:28px 32px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:${color};border-radius:8px;">
            <a href="${esc(dashboard)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Open my dashboard</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td class="px" style="padding:16px 32px;background:#f9fafb;border-top:1px solid ${LINE};font-size:12px;line-height:18px;color:${FAINT};">
        ${esc(firm.name)} &middot; Your briefing arrives every morning at 8 AM with the work waiting for you in the CRM.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  // Plain-text part — what a text-only client or a notification preview shows.
  const text = [
    `Good morning, ${firstName}`,
    `${date}`,
    "",
    `${plural(total, "item")} need${total === 1 ? "s" : ""} your attention today.`,
    "",
    ...groups.slice(0, MAX_SECTIONS).flatMap((g) => [
      `${g.label} (${g.count})`,
      ...g.items.slice(0, ITEMS_PER_SECTION).map((it) => `  - ${it.title}${itemMeta(it.detail) ? ` — ${itemMeta(it.detail)}` : ""}`),
      ...(g.count > ITEMS_PER_SECTION ? [`  View all: ${absolute(baseUrl, g.href)}`] : []),
      "",
    ]),
    `Open your dashboard: ${dashboard}`,
    "",
    `— ${firm.name}`,
  ].join("\n");

  return { subject, html, text };
}
