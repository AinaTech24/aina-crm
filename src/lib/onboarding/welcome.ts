/**
 * The welcome email when a firm finishes onboarding (owner's addition D).
 *
 * ONE email per firm, to the owner (cc the NDA signer when that is someone
 * else), through the platform's transactional mail — never the firm's client
 * comms pipeline. It is sent only once the firm is onboarded, and only once:
 * the tenant row is locked (SKIP LOCKED) and stamped in the same transaction.
 * A failed send never undoes onboarding — it is logged, audited and retried by
 * the worker's hourly billing job (up to MAX_ATTEMPTS).
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { sendSystemEmail } from "@/lib/comms/system-email";
import { LEGAL } from "@/lib/legal/company";
import { CYCLE_LABEL, inr, parseCycle } from "@/lib/billing/aum-pricing";

export const WELCOME_MAX_ATTEMPTS = 8;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type WelcomeFacts = {
  ownerName: string | null;
  firmName: string;
  cycleLabel: string | null;
  users: number | null;
  tierLabel: string | null;
  nextRenewal: string | null;
  nextAmountPaise: number | null;
  logoMissing: boolean;
  ndaEmailedTo: string | null;
  baseUrl: string;
};

/** Pure: subject, text and HTML of the welcome email. */
export function welcomeEmail(f: WelcomeFacts): { subject: string; text: string; html: string } {
  const hello = `Welcome${f.ownerName ? `, ${f.ownerName}` : ""}!`;
  const plan =
    f.cycleLabel && f.users
      ? `Your plan: ${f.cycleLabel}, ${f.users} user${f.users === 1 ? "" : "s"}${f.tierLabel ? `, AUM tier ${f.tierLabel}` : ""}.`
      : null;
  const renewal = f.nextRenewal && f.nextAmountPaise != null ? `Next renewal: ${f.nextRenewal} — ${inr(f.nextAmountPaise)} incl. GST, by auto-pay.` : null;
  const steps: Array<[string, string]> = [
    ["Import your clients and your CAMS / KFintech files", `${f.baseUrl}/dashboard/rta-imports`],
    ["Invite your team", `${f.baseUrl}/dashboard/employees/new`],
    ["Connect WhatsApp and email", `${f.baseUrl}/dashboard/settings/integrations`],
    ...(f.logoMissing ? ([["Add your firm's logo", `${f.baseUrl}/dashboard/settings/organisation`]] as Array<[string, string]>) : []),
    ["Browse the Help centre", `${f.baseUrl}/knowledge-base`],
  ];
  const support = `Questions? Write to ${LEGAL.email}${LEGAL.phone ? ` or call ${LEGAL.phone}` : ""}.`;
  const nda = f.ndaEmailedTo ? `A signed copy of your NDA was emailed to ${f.ndaEmailedTo} when it was signed.` : null;
  const subject = `Welcome to Aina CRM — ${f.firmName} is ready`;
  const text = [
    hello,
    `${f.firmName} is set up on Aina CRM.`,
    plan,
    renewal,
    `Go to your CRM: ${f.baseUrl}/dashboard`,
    "First steps:",
    ...steps.map(([l, u]) => `- ${l}: ${u}`),
    support,
    nda,
    `— ${LEGAL.brand}, ${LEGAL.legalEntity}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const p = (s: string) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#48585f;">${esc(s)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Inter,Arial,sans-serif;color:#16242b;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;"><div style="background:#fff;border:1px solid #e6ebee;border-radius:14px;padding:28px;">
<h1 style="margin:0 0 12px;font-size:20px;">${esc(hello)}</h1>
${p(`${f.firmName} is set up on Aina CRM.`)}${plan ? p(plan) : ""}${renewal ? p(renewal) : ""}
<a href="${esc(`${f.baseUrl}/dashboard`)}" style="display:inline-block;background:#C5202A;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:9px;margin:4px 0 18px;">Go to your CRM</a>
<p style="margin:0 0 6px;font-size:14px;font-weight:600;">First steps</p>
<ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.7;color:#48585f;">${steps.map(([l, u]) => `<li><a href="${esc(u)}" style="color:#16242b;">${esc(l)}</a></li>`).join("")}</ul>
${p(support)}${nda ? p(nda) : ""}
<p style="margin:16px 0 0;font-size:12px;color:#8a979d;">${esc(`${LEGAL.brand} · ${LEGAL.legalEntity}`)}</p>
</div></div></body></html>`;
  return { subject, text, html };
}

/** Send the welcome email if the firm is onboarded and it has not gone yet. */
export async function sendWelcomeEmail(tenantId: string): Promise<"sent" | "skipped" | "failed"> {
  return withSystem(async (tx) => {
    const t = (await tx.execute(sql`
      SELECT id, display_name, logo_url, onboarded_at, welcome_email_status, welcome_email_attempts
        FROM tenants
       WHERE id = ${tenantId}::uuid AND onboarded_at IS NOT NULL AND welcome_email_sent_at IS NULL
         AND welcome_email_attempts < ${WELCOME_MAX_ATTEMPTS}
       FOR UPDATE SKIP LOCKED
    `)).rows[0] as { id: string; display_name: string; logo_url: string | null } | undefined;
    if (!t) return "skipped";

    const owner = (await tx.execute(sql`
      SELECT lower(email) AS email, name FROM users
       WHERE tenant_id = ${tenantId}::uuid AND 'owner' = ANY(roles) AND status = 'active'
       ORDER BY created_at LIMIT 1
    `)).rows[0] as { email: string; name: string | null } | undefined;
    const nda = (await tx.execute(sql`
      SELECT lower(email) AS email FROM legal_acceptances
       WHERE tenant_id = ${tenantId}::uuid AND kind = 'nda' ORDER BY accepted_at DESC LIMIT 1
    `)).rows[0] as { email: string } | undefined;
    const sub = (await tx.execute(sql`
      SELECT billing_cycle, seats_override, cycle_quote, cycle_total_paise, license_end_at, next_cycle
        FROM subscriptions WHERE tenant_id = ${tenantId}::uuid
    `)).rows[0] as
      | { billing_cycle: string | null; seats_override: number | null; cycle_quote: { tierLabel?: string } | null; cycle_total_paise: number | null; license_end_at: string | null; next_cycle: { quote?: { totalPaise?: number } } | null }
      | undefined;
    if (!owner) {
      await tx.execute(sql`UPDATE tenants SET welcome_email_status = 'failed', welcome_email_attempts = welcome_email_attempts + 1, welcome_email_last_error = 'no owner email' WHERE id = ${tenantId}::uuid`);
      return "failed";
    }
    const cycle = parseCycle(sub?.billing_cycle);
    const mail = welcomeEmail({
      ownerName: owner.name,
      firmName: t.display_name,
      cycleLabel: cycle ? CYCLE_LABEL[cycle] : null,
      users: sub?.seats_override ?? null,
      tierLabel: sub?.cycle_quote?.tierLabel ?? null,
      nextRenewal: sub?.license_end_at ? new Date(sub.license_end_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }) : null,
      nextAmountPaise: sub?.next_cycle?.quote?.totalPaise ?? sub?.cycle_total_paise ?? null,
      logoMissing: !t.logo_url,
      ndaEmailedTo: nda?.email ?? null,
      baseUrl: process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? LEGAL.url,
    });
    const cc = nda?.email && nda.email !== owner.email ? [nda.email] : [];
    const res = await sendSystemEmail({ tenantId, to: owner.email, cc, subject: mail.subject, text: mail.text, html: mail.html, idempotencyKey: `welcome:${tenantId}` });
    if (res.sent) {
      await tx.execute(sql`UPDATE tenants SET welcome_email_status = 'sent', welcome_email_sent_at = now(), welcome_email_attempts = welcome_email_attempts + 1, welcome_email_last_error = NULL WHERE id = ${tenantId}::uuid`);
      await recordAudit(tx, { tenantId, actorType: "system", action: "onboarding.welcome_email_sent", entityType: "tenant", entityId: tenantId, after: { to: owner.email, cc } });
      return "sent";
    }
    await tx.execute(sql`UPDATE tenants SET welcome_email_status = 'failed', welcome_email_attempts = welcome_email_attempts + 1, welcome_email_last_error = ${res.reason ?? "send failed"} WHERE id = ${tenantId}::uuid`);
    await recordAudit(tx, { tenantId, actorType: "system", action: "onboarding.welcome_email_failed", entityType: "tenant", entityId: tenantId, after: { reason: res.reason ?? "send failed" } });
    console.error(`[welcome] email for tenant ${tenantId} failed (${res.reason ?? "send failed"}) — will retry`);
    return "failed";
  });
}

export async function retryWelcomeEmails(limit = 50): Promise<{ tried: number; sent: number }> {
  const ids = await withSystem(async (tx) =>
    ((await tx.execute(sql`
      SELECT id FROM tenants
       WHERE onboarded_at IS NOT NULL AND welcome_email_sent_at IS NULL AND welcome_email_status = 'failed'
         AND welcome_email_attempts < ${WELCOME_MAX_ATTEMPTS} AND deleted_at IS NULL
       ORDER BY onboarded_at LIMIT ${limit}
    `)).rows as Array<{ id: string }>).map((r) => r.id)
  );
  let sent = 0;
  for (const id of ids) {
    try {
      if ((await sendWelcomeEmail(id)) === "sent") sent++;
    } catch (err) {
      console.error("[welcome] retry failed:", (err as Error)?.message);
    }
  }
  return { tried: ids.length, sent };
}
