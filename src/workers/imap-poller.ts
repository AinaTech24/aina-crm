/**
 * IMAP inbox-sync worker.
 *
 * For every tenant that connected a mailbox (Settings → Email → Connect your
 * mailbox) with IMAP credentials, polls the INBOX for new messages and ingests
 * them into the unified `communications` log as inbound email — matched to an
 * investor or lead by the sender's address when possible.
 *
 * State: a per-tenant high-water UID is stored in the (encrypted) integration
 * config (`imap.lastUid`) so each cycle only fetches genuinely-new mail. IMAP
 * network I/O happens OUTSIDE the DB transaction so a slow mailbox never pins a
 * Postgres connection.
 */

import { and, eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { imapFetchSince, type InboundEmail } from "@/lib/comms/imap";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { communications, investors, leads } from "@/db/schema";
import { sql } from "drizzle-orm";

async function ingest(tenantId: string, msgs: InboundEmail[]): Promise<{ ingested: number; maxUid: number }> {
  let ingested = 0;
  let maxUid = 0;
  await withTenant(tenantId, async (tx) => {
    for (const m of msgs) {
      if (m.uid > maxUid) maxUid = m.uid;
      const ext = m.messageId ?? `imap-${tenantId}-${m.uid}`;

      // Skip if we've already logged this message (idempotent re-runs).
      const [dup] = await tx
        .select({ id: communications.id })
        .from(communications)
        .where(and(eq(communications.tenantId, tenantId), eq(communications.channel, "email"), eq(communications.externalId, ext)))
        .limit(1);
      if (dup) continue;

      // Best-effort match the sender to an existing investor, else a lead.
      const fromEmail = m.from?.toLowerCase().trim() ?? null;
      let investorId: string | null = null;
      let leadId: string | null = null;
      if (fromEmail) {
        const [inv] = await tx
          .select({ id: investors.id })
          .from(investors)
          .where(and(eq(investors.tenantId, tenantId), sql`lower(${investors.email}) = ${fromEmail}`))
          .limit(1);
        if (inv) investorId = inv.id;
        else {
          const [ld] = await tx
            .select({ id: leads.id })
            .from(leads)
            .where(and(eq(leads.tenantId, tenantId), sql`lower(${leads.email}) = ${fromEmail}`))
            .limit(1);
          if (ld) leadId = ld.id;
        }
      }

      await tx.insert(communications).values({
        tenantId,
        channel: "email",
        direction: "inbound",
        investorId,
        leadId,
        externalId: ext,
        status: "delivered",
        inboundContent: {
          from: m.from ?? null,
          fromName: m.fromName ?? null,
          subject: m.subject ?? null,
          text: m.text ?? null,
          html: m.html ?? null,
          messageId: m.messageId ?? null,
          receivedAt: m.date ? m.date.toISOString() : null,
        },
      } as any);
      ingested++;
    }
  });
  return { ingested, maxUid };
}

export function startImapPollerWorker() {
  const interval = Number(process.env.IMAP_POLLER_INTERVAL_MS ?? 120_000);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const rows = await withSystem(async (tx) =>
        tx
          .select({
            tenantId: tenantIntegrations.tenantId,
            encryptedConfig: tenantIntegrations.encryptedConfig,
          })
          .from(tenantIntegrations)
          .where(and(eq(tenantIntegrations.provider, "mailbox"), eq(tenantIntegrations.isActive, true)))
          .limit(200)
      );

      for (const row of rows) {
        let config: any;
        try {
          config = JSON.parse(decrypt(row.encryptedConfig));
        } catch {
          continue; // can't decrypt (key rotated?) — skip, not fatal
        }
        const imap = config?.imap;
        if (!imap?.host || !imap?.user || !imap?.pass) continue;
        const lastUid = Number(imap.lastUid ?? 0);

        let msgs: InboundEmail[];
        try {
          msgs = await imapFetchSince(
            { host: imap.host, port: Number(imap.port), secure: !!imap.secure, user: imap.user, pass: imap.pass },
            lastUid
          );
        } catch (e) {
          console.error(`[imap] ${row.tenantId} fetch failed:`, (e as Error).message);
          continue;
        }
        if (!msgs.length) continue;

        const { ingested, maxUid } = await ingest(row.tenantId, msgs);

        // Persist the new high-water UID (only touch encrypted_config; leave
        // sender_config / is_active untouched).
        if (maxUid > lastUid) {
          config.imap.lastUid = maxUid;
          const enc = encrypt(JSON.stringify(config));
          await withTenant(row.tenantId, async (tx) => {
            await tx
              .update(tenantIntegrations)
              .set({ encryptedConfig: enc, updatedAt: new Date() })
              .where(and(eq(tenantIntegrations.tenantId, row.tenantId), eq(tenantIntegrations.provider, "mailbox")));
          });
        }
        if (ingested) console.log(`[imap] ${row.tenantId}: ingested ${ingested} message(s), uid→${maxUid}`);
      }
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, interval);
  console.log(`[imap] inbox poller started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
