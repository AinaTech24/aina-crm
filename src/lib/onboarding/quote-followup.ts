/**
 * Following up a price that was asked for but never bought (the owner's
 * request of 2026-11-18). The worker's hourly billing tick runs
 * `runQuoteFollowups`: a quote at least a day old that never became a firm,
 * whose email is not already a sign-in and that was never followed up, gets
 * ONE email — its package summary, "Continue where you left off" (a resume
 * link that reopens /pricing at the packages, re-priced today) and "Questions?
 * WhatsApp us". `followup_sent_at` (migration 0269) is stamped in the same
 * transaction as the send, so it never goes twice.
 *
 * One person, one email: when an address asked for several prices, only the
 * newest is followed up and the others are stamped with it. Quotes older than
 * a week are left alone (a stale price is not a reason to write to someone).
 * Without SMTP the run logs and sends nothing — and stamps nothing, so the
 * email goes once mail is configured, while the quote is still within the week.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { PLATFORM_TENANT_ID } from "@/lib/platform";
import { sendSystemEmail } from "@/lib/comms/system-email";
import { loadEmailConfig } from "@/lib/comms/email-config";
import { LEGAL } from "@/lib/legal/company";
import { cycleLabel, inr, type CycleQuote } from "@/lib/billing/aum-pricing";
import { issueResumeToken, resumeLink } from "@/lib/billing/quotes";
import { WHATSAPP_US_URL } from "./messages";

export const FOLLOWUP_AFTER_HOURS = 24;
export const FOLLOWUP_MAX_AGE_DAYS = 7;

export type FollowupCandidate = {
  id: string;
  email: string;
  createdAt: Date;
  convertedTenantId: string | null;
  followupSentAt: Date | null;
  /** The email already signs in somewhere (any live firm, or Aina). */
  emailInUse: boolean;
};

/**
 * Pure: which quotes get the follow-up now, and which quotes of the same
 * person are settled by it (`alsoStamp`). A person with ANY converted or
 * followed-up quote is never written to again.
 */
export function selectQuoteFollowups(rows: FollowupCandidate[], now: Date): Array<{ id: string; email: string; alsoStamp: string[] }> {
  const byEmail = new Map<string, FollowupCandidate[]>();
  for (const r of rows) {
    const k = r.email.trim().toLowerCase();
    byEmail.set(k, [...(byEmail.get(k) ?? []), r]);
  }
  const out: Array<{ id: string; email: string; alsoStamp: string[] }> = [];
  const oldest = now.getTime() - FOLLOWUP_MAX_AGE_DAYS * 86_400_000;
  const youngest = now.getTime() - FOLLOWUP_AFTER_HOURS * 3_600_000;
  for (const [email, qs] of byEmail) {
    if (qs.some((q) => q.emailInUse || q.convertedTenantId || q.followupSentAt)) continue;
    const newest = [...qs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const t = newest.createdAt.getTime();
    // The NEWEST must be a day old: someone who asked again an hour ago is still deciding.
    if (t > youngest || t < oldest) continue;
    out.push({ id: newest.id, email, alsoStamp: qs.filter((q) => q.id !== newest.id).map((q) => q.id) });
  }
  return out;
}

export type QuoteStage = "paid" | "firm_unpaid" | "followed_up" | "new";

export const STAGE_LABEL: Record<QuoteStage, string> = {
  paid: "Paid",
  firm_unpaid: "Firm created (unpaid)",
  followed_up: "Followed up",
  new: "New",
};

/** Pure: where a quote stands, for Aina Admin → Pricing quotes. The furthest stage wins. */
export function quoteStage(q: { paidAt: unknown; convertedTenantId: unknown; followupSentAt: unknown }): QuoteStage {
  if (q.paidAt) return "paid";
  if (q.convertedTenantId) return "firm_unpaid";
  if (q.followupSentAt) return "followed_up";
  return "new";
}

export type FollowupFacts = {
  contactName: string;
  firmName: string;
  aumCrore: number;
  users: number;
  tierLabel: string | null;
  cycles: CycleQuote[];
  resumeUrl: string;
  whatsappUrl: string;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const FOLLOWUP_FOOTER = "You're receiving this because you asked for a price on our website.";

/** Pure: subject, text and HTML of the follow-up. */
export function quoteFollowupEmail(f: FollowupFacts): { subject: string; text: string; html: string } {
  const first = f.contactName.trim().split(/\s+/)[0] || "there";
  const hello = `Hi ${first},`;
  const intro = `Thank you for asking for Aina CRM's pricing for ${f.firmName}. Your packages are saved — you can pick up where you left off.`;
  const summary = `Your details: ₹${f.aumCrore.toLocaleString("en-IN")} Cr AUM${f.tierLabel ? ` (${f.tierLabel})` : ""} · ${f.users} user${f.users === 1 ? "" : "s"}.`;
  const lines = f.cycles.map((c) => `${cycleLabel(c.cycle, c.months)}: ${inr(c.totalPaise)} incl. GST`);
  const reprice = "Prices are worked out again when you open the link, so you always see today's.";
  const subject = `Your Aina CRM packages for ${f.firmName}`;
  const text = [
    hello,
    intro,
    summary,
    ...(lines.length ? ["Your packages:", ...lines.map((l) => `- ${l}`)] : []),
    `Continue where you left off: ${f.resumeUrl}`,
    reprice,
    `Questions? WhatsApp us: ${f.whatsappUrl}`,
    `— ${LEGAL.brand}, ${LEGAL.legalEntity}`,
    FOLLOWUP_FOOTER,
  ].join("\n\n");
  const p = (s: string) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#48585f;">${esc(s)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Inter,Arial,sans-serif;color:#16242b;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;"><div style="background:#fff;border:1px solid #e6ebee;border-radius:14px;padding:28px;">
<h1 style="margin:0 0 12px;font-size:20px;">${esc(hello)}</h1>
${p(intro)}${p(summary)}
${lines.length ? `<ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.7;color:#16242b;">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
<a href="${esc(f.resumeUrl)}" style="display:inline-block;background:#C5202A;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:9px;margin:4px 0 14px;">Continue where you left off</a>
${p(reprice)}
<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#48585f;">Questions? <a href="${esc(f.whatsappUrl)}" style="color:#16242b;font-weight:600;">WhatsApp us</a>.</p>
<p style="margin:16px 0 0;font-size:12px;color:#8a979d;">${esc(`${LEGAL.brand} · ${LEGAL.legalEntity}`)}<br/>${esc(FOLLOWUP_FOOTER)}</p>
</div></div></body></html>`;
  return { subject, text, html };
}

export const appBaseUrl = () => (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? LEGAL.url).replace(/\/$/, "");

class NotSent extends Error {}

/** The hourly scan. Never throws for a mail problem. */
export async function runQuoteFollowups(now = new Date(), limit = 50): Promise<{ due: number; sent: number; skipped?: string }> {
  const rows = await withSystem(async (tx) =>
    (await tx.execute(sql`
      SELECT q.id, lower(q.email) AS email, q.created_at, q.converted_tenant_id, q.followup_sent_at,
             EXISTS (
               SELECT 1 FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
                WHERE lower(u.email) = lower(q.email)
                  AND (u.tenant_id = ${PLATFORM_TENANT_ID}::uuid OR t.deleted_at IS NULL)
             ) AS email_in_use
        FROM pricing_quotes q
       WHERE lower(q.email) IN (
               SELECT lower(email) FROM pricing_quotes
                WHERE followup_sent_at IS NULL AND converted_tenant_id IS NULL
                  AND created_at <= ${new Date(now.getTime() - FOLLOWUP_AFTER_HOURS * 3_600_000)}
                  AND created_at >= ${new Date(now.getTime() - FOLLOWUP_MAX_AGE_DAYS * 86_400_000)}
             )
    `)).rows as Array<{ id: string; email: string; created_at: string; converted_tenant_id: string | null; followup_sent_at: string | null; email_in_use: boolean }>
  );
  const due = selectQuoteFollowups(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      createdAt: new Date(r.created_at),
      convertedTenantId: r.converted_tenant_id,
      followupSentAt: r.followup_sent_at ? new Date(r.followup_sent_at) : null,
      emailInUse: !!r.email_in_use,
    })),
    now
  ).slice(0, limit);
  if (!due.length) return { due: 0, sent: 0 };

  const mail = await loadEmailConfig();
  if (!mail.configured || !mail.host) {
    console.warn(`[quote-followup] ${due.length} quote(s) due a follow-up, but email is not configured — nothing sent.`);
    return { due: due.length, sent: 0, skipped: "email_not_configured" };
  }

  let sent = 0;
  for (const d of due) {
    try {
      await withSystem(async (tx) => {
        const q = (await tx.execute(sql`
          SELECT id, contact_name, firm_name, aum_crore, users, quote FROM pricing_quotes
           WHERE id = ${d.id}::uuid AND followup_sent_at IS NULL AND converted_tenant_id IS NULL
           FOR UPDATE SKIP LOCKED
        `)).rows[0] as { id: string; contact_name: string; firm_name: string; aum_crore: string; users: number; quote: { tierLabel?: string; cycles?: CycleQuote[] } } | undefined;
        if (!q) throw new NotSent("taken");
        const token = await issueResumeToken(tx, q.id);
        const m = quoteFollowupEmail({
          contactName: q.contact_name,
          firmName: q.firm_name,
          aumCrore: Number(q.aum_crore),
          users: Number(q.users),
          tierLabel: q.quote?.tierLabel ?? null,
          cycles: q.quote?.cycles ?? [],
          resumeUrl: resumeLink(appBaseUrl(), q.id, token),
          whatsappUrl: WHATSAPP_US_URL,
        });
        const ids = [q.id, ...d.alsoStamp];
        await tx.execute(sql`
          UPDATE pricing_quotes SET followup_sent_at = ${now}, updated_at = now()
           WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) AND followup_sent_at IS NULL
        `);
        const res = await sendSystemEmail({ tenantId: PLATFORM_TENANT_ID, to: d.email, subject: m.subject, text: m.text, html: m.html, idempotencyKey: `quote-followup:${q.id}` });
        // Not sent → roll the stamp and the new resume token back; the next run tries again.
        if (!res.sent) throw new NotSent(res.reason ?? "send failed");
      });
      sent++;
    } catch (err) {
      if (!(err instanceof NotSent)) console.error("[quote-followup] quote failed:", (err as Error)?.message);
      else if (err.message !== "taken") console.warn(`[quote-followup] not sent (${err.message}) — will retry`);
    }
  }
  return { due: due.length, sent };
}
