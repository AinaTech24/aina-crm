/**
 * Close the service requests the email intake opened by mistake.
 *
 * Why they exist (an email no longer opens a ticket — see lib/comms/automated-mail.ts): the firm's own
 * "SIP INSTALLMENT REMINDER" mail, mail from staff whose address is also on a
 * client record, forwards, a mailbox's old history and repeat emails each
 * opened a ticket — Nimesh C Shah Financial Services had 483 in ten days, 474
 * of them escalated by the SLA scanner for sitting unanswered.
 *
 * What it closes, per tenant — only tickets opened by "Email intake" that no
 * person has touched (every timeline event is the system's; no owner assigned;
 * no reply recorded):
 *   - automated   the ticket's own text is a reminder / newsletter / no-reply mail
 *   - forward     the subject starts "Fwd:" / "Fw:"
 *   - firm mail   the client's address on file is the firm's own (a user, the
 *                 firm, or its connected mailbox) — the mail came from staff
 *   - repeat      a further open ticket for the same client and type; the
 *                 earliest of a group stays, the rest are closed
 * Everything else is listed for a person to look at and left alone.
 *
 * Closing is status = closed with resolved_at, a resolution note and a timeline
 * event; nothing is deleted, so the register keeps the history.
 *
 * Dry run by default.
 *
 *   tsx scripts/close-auto-email-tickets.ts --tenant <uuid>
 *   tsx scripts/close-auto-email-tickets.ts --tenant <uuid> --apply
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { automatedReason, isForwarded } from "../src/lib/comms/automated-mail";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const val = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

type Row = {
  id: string;
  ticket_no: string;
  investor_id: string | null;
  type: string;
  subject: string;
  description: string | null;
  status: string;
  created_at: string;
  client_email: string | null;
  client_name: string | null;
  firm_mail: boolean;
  human_touched: boolean;
};

async function main() {
  const tenantId = val("--tenant");
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    console.error("usage: tsx scripts/close-auto-email-tickets.ts --tenant <uuid> [--apply]");
    process.exit(2);
  }
  const apply = flag("--apply");

  await withTenant(tenantId, async (tx) => {
    const rows = (
      await tx.execute(sql`
        SELECT s.id::text AS id, s.ticket_no, s.investor_id::text AS investor_id, s.type, s.subject, s.description,
               s.status, s.created_at::text AS created_at, i.email AS client_email, i.name AS client_name,
               (i.email IS NOT NULL AND (
                  EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = s.tenant_id AND lower(u.email) = lower(i.email))
               OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = s.tenant_id AND lower(t.email) = lower(i.email))
               OR EXISTS (SELECT 1 FROM tenant_integrations ti
                           WHERE ti.tenant_id = s.tenant_id AND lower(ti.sender_config->>'fromEmail') = lower(i.email))
               )) AS firm_mail,
               (s.assigned_to_user_id IS NOT NULL OR s.responded_at IS NOT NULL OR EXISTS (
                  SELECT 1 FROM jsonb_array_elements(COALESCE(s.timeline, '[]'::jsonb)) e
                   WHERE COALESCE(e->>'by', 'system') NOT IN ('system', 'Email intake')
               )) AS human_touched
          FROM service_requests s
          LEFT JOIN investors i ON i.id = s.investor_id AND i.tenant_id = s.tenant_id
         WHERE s.tenant_id = ${tenantId}::uuid
           AND s.channel = 'email'
           AND s.status IN ('open', 'escalated', 'in_progress', 'waiting_customer')
           AND COALESCE(s.timeline->0->>'note', '') ILIKE '%Email intake%'
         ORDER BY s.created_at
      `)
    ).rows as unknown as Row[];

    const close = new Map<string, string>(); // id -> reason
    const seen = new Set<string>();
    const review: Row[] = [];
    const touched: Row[] = [];

    for (const r of rows) {
      if (r.human_touched) {
        touched.push(r);
        continue;
      }
      let why: string | null = null;
      if (isForwarded(r.subject)) why = "a forward";
      else {
        const auto = automatedReason({ subject: r.subject, text: r.description });
        if (auto) why = `automated: ${auto}`;
        else if (r.firm_mail) why = "sent from the firm's own address";
      }
      if (!why) {
        const key = `${r.investor_id}|${r.type}`;
        if (seen.has(key)) why = "repeat of an earlier open ticket for the same client";
        else seen.add(key);
      }
      if (why) close.set(r.id, why);
      else review.push(r);
    }

    const byReason = new Map<string, number>();
    for (const w of close.values()) byReason.set(w.replace(/^automated: /, "automated: "), (byReason.get(w) ?? 0) + 1);

    console.log(`tenant ${tenantId}: ${rows.length} open email-intake ticket(s)`);
    console.log(`  to close:        ${close.size}`);
    for (const [w, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(4)}  ${w}`);
    console.log(`  left for review: ${review.length}`);
    console.log(`  touched by a person (never closed): ${touched.length}`);
    for (const r of review.slice(0, 40)) {
      console.log(`    ${r.ticket_no}  ${r.created_at.slice(0, 10)}  ${r.client_name ?? "—"}  [${r.type}]  ${r.subject.slice(0, 70)}`);
    }
    if (review.length > 40) console.log(`    … and ${review.length - 40} more`);

    if (!apply) {
      console.log("\nDry run — nothing written. Re-run with --apply to close the tickets above.");
      return;
    }

    const ids = [...close.keys()];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      for (const id of batch) {
        const note = `Closed: opened automatically from an email that was not a client request (${close.get(id)}).`;
        await tx.execute(sql`
          UPDATE service_requests
             SET status = 'closed',
                 resolved_at = now(),
                 resolution_notes = ${note},
                 timeline = COALESCE(timeline, '[]'::jsonb) || ${JSON.stringify([
                   { at: new Date().toISOString(), by: "system", event: "closed", note },
                 ])}::jsonb,
                 updated_at = now()
           WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
             AND status IN ('open', 'escalated', 'in_progress', 'waiting_customer')
        `);
      }
    }
    console.log(`\nClosed ${ids.length} ticket(s).`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
