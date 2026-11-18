/**
 * Firms that paid but have not started (the owner's request of 2026-11-18).
 *
 * A firm whose FIRST payment (its first tax invoice — the online purchase,
 * lib/billing) is at least 3 days old and that has no clients yet has stalled
 * at the hardest step. The worker's daily scan emails its owner ONCE — "Need a
 * hand importing your clients?" with the import link and the onboarding-call
 * link — and stamps `tenants.onboarding_nudged_at` (migration 0269) in the same
 * transaction. Aina Admin → Pricing → Stalled onboarding lists the same firms
 * (nudged or not) so a person can call them.
 *
 * Without SMTP the scan logs and stamps nothing, so the email still goes once
 * mail is configured.
 */

import { sql } from "drizzle-orm";
import { withSystem, type Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { sendSystemEmail } from "@/lib/comms/system-email";
import { loadEmailConfig } from "@/lib/comms/email-config";
import { LEGAL } from "@/lib/legal/company";
import { IMPORT_CLIENTS_HREF, IMPORT_EXCEL_HREF, onboardingCallUrl } from "./messages";
import { appBaseUrl } from "./quote-followup";

export const STALLED_AFTER_DAYS = 3;

export type StalledFirm = {
  tenantId: string;
  firmName: string;
  firstPaidAt: Date;
  clientCount: number;
  nudgedAt: Date | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerMobile: string | null;
};

/** Pure: has this firm stalled (paid ≥ 3 days ago, no clients)? */
export function isStalled(f: Pick<StalledFirm, "firstPaidAt" | "clientCount">, now: Date, afterDays = STALLED_AFTER_DAYS): boolean {
  return f.clientCount === 0 && now.getTime() - f.firstPaidAt.getTime() >= afterDays * 86_400_000;
}

/** Pure: the firms to email now — stalled, never nudged, with an owner to write to. */
export function selectStalledNudges(firms: StalledFirm[], now: Date): StalledFirm[] {
  return firms.filter((f) => isStalled(f, now) && !f.nudgedAt && !!f.ownerEmail);
}

/**
 * Every paid firm with no clients (live, not deleted), first payment first —
 * the admin list (which also shows the not-yet-3-days ones' age) and the scan.
 * Run inside withSystem: it reads across firms.
 */
export async function loadPaidFirmsWithoutClients(tx: Tx): Promise<StalledFirm[]> {
  const r = await tx.execute(sql`
    WITH paid AS (
      SELECT tenant_id, min(issued_at) AS first_paid_at FROM billing_invoices WHERE tenant_id IS NOT NULL GROUP BY tenant_id
    )
    SELECT t.id, t.display_name, p.first_paid_at, t.onboarding_nudged_at,
           o.name AS owner_name, lower(o.email) AS owner_email, COALESCE(o.phone, t.phone) AS owner_mobile,
           (SELECT count(*)::int FROM investors i WHERE i.tenant_id = t.id AND i.deleted_at IS NULL) AS client_count
      FROM paid p
      JOIN tenants t ON t.id = p.tenant_id AND t.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT name, email, phone FROM users
         WHERE tenant_id = t.id AND 'owner' = ANY(roles) AND status = 'active' AND deleted_at IS NULL
         ORDER BY created_at LIMIT 1
      ) o ON true
     WHERE NOT EXISTS (SELECT 1 FROM investors i WHERE i.tenant_id = t.id AND i.deleted_at IS NULL)
     ORDER BY p.first_paid_at
  `);
  return (r.rows as Array<Record<string, unknown>>).map((x) => ({
    tenantId: String(x.id),
    firmName: String(x.display_name ?? ""),
    firstPaidAt: new Date(String(x.first_paid_at)),
    clientCount: Number(x.client_count ?? 0),
    nudgedAt: x.onboarding_nudged_at ? new Date(String(x.onboarding_nudged_at)) : null,
    ownerName: (x.owner_name as string | null) ?? null,
    ownerEmail: (x.owner_email as string | null) ?? null,
    ownerMobile: (x.owner_mobile as string | null) ?? null,
  }));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Pure: the nudge email. */
export function stalledNudgeEmail(f: { ownerName: string | null; firmName: string; baseUrl: string; callUrl: string }): { subject: string; text: string; html: string } {
  const first = (f.ownerName ?? "").trim().split(/\s+/)[0];
  const hello = first ? `Hi ${first},` : "Hello,";
  const intro = `${f.firmName}'s Aina CRM is ready, but there are no clients in it yet. Bringing them in is the step that makes everything else work — reminders, SIP follow-ups, reviews and reports.`;
  const how = "Upload your CAMS / KFintech mailback files and we build your client book, folios and SIPs from them. An Excel sheet works too.";
  const importUrl = `${f.baseUrl}${IMPORT_CLIENTS_HREF}`;
  const excelUrl = `${f.baseUrl}${IMPORT_EXCEL_HREF}`;
  const call = "Prefer to do it together? Book your free onboarding call and we will walk you through it.";
  const subject = "Need a hand importing your clients?";
  const text = [
    hello,
    intro,
    how,
    `Import your clients: ${importUrl}`,
    `From an Excel sheet: ${excelUrl}`,
    `${call} ${f.callUrl}`,
    `— ${LEGAL.brand}, ${LEGAL.legalEntity}`,
  ].join("\n\n");
  const p = (s: string) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#48585f;">${esc(s)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Inter,Arial,sans-serif;color:#16242b;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;"><div style="background:#fff;border:1px solid #e6ebee;border-radius:14px;padding:28px;">
<h1 style="margin:0 0 12px;font-size:20px;">${esc(subject)}</h1>
${p(hello)}${p(intro)}${p(how)}
<a href="${esc(importUrl)}" style="display:inline-block;background:#C5202A;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:9px;margin:4px 0 14px;">Import your clients</a>
<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#48585f;">Or <a href="${esc(excelUrl)}" style="color:#16242b;">import from an Excel sheet</a>.</p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#48585f;">${esc(call)} <a href="${esc(f.callUrl)}" style="color:#16242b;font-weight:600;">Book your free onboarding call</a>.</p>
<p style="margin:16px 0 0;font-size:12px;color:#8a979d;">${esc(`${LEGAL.brand} · ${LEGAL.legalEntity}`)}</p>
</div></div></body></html>`;
  return { subject, text, html };
}

class NotSent extends Error {}

/** The daily scan. Never throws for a mail problem. */
export async function runStalledNudges(now = new Date()): Promise<{ due: number; sent: number; skipped?: string }> {
  const due = selectStalledNudges(await withSystem((tx) => loadPaidFirmsWithoutClients(tx)), now);
  if (!due.length) return { due: 0, sent: 0 };
  const mail = await loadEmailConfig();
  if (!mail.configured || !mail.host) {
    console.warn(`[onboarding-nudge] ${due.length} stalled firm(s) due a nudge, but email is not configured — nothing sent.`);
    return { due: due.length, sent: 0, skipped: "email_not_configured" };
  }
  const callUrl = onboardingCallUrl();
  let sent = 0;
  for (const f of due) {
    try {
      await withSystem(async (tx) => {
        // Re-checked under the row lock: a client may have arrived meanwhile.
        const still = (await tx.execute(sql`
          SELECT id FROM tenants
           WHERE id = ${f.tenantId}::uuid AND onboarding_nudged_at IS NULL AND deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM investors i WHERE i.tenant_id = tenants.id AND i.deleted_at IS NULL)
           FOR UPDATE SKIP LOCKED
        `)).rows[0];
        if (!still) throw new NotSent("taken");
        await tx.execute(sql`UPDATE tenants SET onboarding_nudged_at = ${now} WHERE id = ${f.tenantId}::uuid`);
        const m = stalledNudgeEmail({ ownerName: f.ownerName, firmName: f.firmName, baseUrl: appBaseUrl(), callUrl });
        const res = await sendSystemEmail({ tenantId: f.tenantId, to: f.ownerEmail!, subject: m.subject, text: m.text, html: m.html, idempotencyKey: `onboarding-nudge:${f.tenantId}` });
        if (!res.sent) throw new NotSent(res.reason ?? "send failed");
        await recordAudit(tx, { tenantId: f.tenantId, actorType: "system", action: "onboarding.nudge_sent", entityType: "tenant", entityId: f.tenantId, after: { to: f.ownerEmail } });
      });
      sent++;
    } catch (err) {
      if (!(err instanceof NotSent)) console.error("[onboarding-nudge] firm failed:", (err as Error)?.message);
      else if (err.message !== "taken") console.warn(`[onboarding-nudge] not sent (${err.message}) — will retry`);
    }
  }
  return { due: due.length, sent };
}
