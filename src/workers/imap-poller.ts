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

import { and, eq, desc, inArray, or } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant, type Tx } from "@/db/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { imapFetchSince, type InboundEmail, type ImapConfig } from "@/lib/comms/imap";
import { ingestInboundBatch, pgErrorOf, type IngestResult, type SanitizedInbound } from "@/lib/comms/inbound-ingest";
import { describeMailError } from "@/lib/comms/connection-error";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { communications, investors, leads } from "@/db/schema";
import { maybeRouteEmailToTicket } from "@/lib/comms/email-to-ticket";
import { refreshAccessToken, getProviderDef, type OAuthProvider } from "@/lib/comms/oauth";
import { sql } from "drizzle-orm";
import { captureError } from "@/lib/observability/capture";

/** Whole-batch failures at one UID before a still-failing message is held. */
const MAX_TRANSIENT_STREAK = 5;
/** Held-message records kept on the mailbox's config (oldest dropped). */
const MAX_HELD_RECORDED = 100;

/**
 * Store a fetched batch. Each message goes in its own savepoint
 * (lib/comms/inbound-ingest.ts), so one message that cannot be stored is held
 * and the rest still land; only a transient failure throws, leaving the
 * mailbox's high-water UID where it was for the next poll.
 */
async function ingest(
  tenantId: string,
  msgs: InboundEmail[],
  ownerUserId: string | null,
  holdOnTransient: boolean
): Promise<IngestResult> {
  return withTenant(tenantId, (tx) =>
    ingestInboundBatch(
      msgs,
      {
        // Idempotent re-runs: the message sits under external_id = its id, or —
        // when another firm already held that Message-ID — with external_id
        // NULL and the id in message_id (comms_message_id_idx covers it).
        alreadyIngested: async (ext) => {
          const [dup] = await tx
            .select({ id: communications.id })
            .from(communications)
            .where(
              and(
                eq(communications.tenantId, tenantId),
                eq(communications.channel, "email"),
                or(eq(communications.externalId, ext), and(eq(communications.direction, "inbound"), eq(communications.messageId, ext)))
              )
            )
            .limit(1);
          return !!dup;
        },
        savepoint: (fn) => tx.transaction(() => fn()),
        store: (m, externalId, ref) => storeMessage(tx, tenantId, ownerUserId, m, externalId, ref),
      },
      { tenantId, holdOnTransient }
    )
  );
}

async function storeMessage(
  tx: Tx,
  tenantId: string,
  ownerUserId: string | null,
  m: SanitizedInbound,
  externalId: string | null,
  ref: string
): Promise<void> {
  // Best-effort match the sender to an existing investor, else a lead.
  const fromEmail = m.from?.toLowerCase().trim() || null;
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

  // ── Threading + reply detection ───────────────────────────────────
  // (a) Header match: link to the outbound whose Message-ID this reply
  //     references (works when we sent via SMTP, where messageId is real).
  const refIds = [m.inReplyTo, ...(m.references?.split(/\s+/) ?? [])]
    .map((r) => r?.trim())
    .filter(Boolean) as string[];
  let threadId: string | null = null;
  let replyToOutboundId: string | null = null;
  if (refIds.length) {
    const [parent] = await tx
      .select({ id: communications.id, threadId: communications.threadId })
      .from(communications)
      .where(and(eq(communications.tenantId, tenantId), eq(communications.channel, "email"), eq(communications.direction, "outbound"), inArray(communications.messageId, refIds)))
      .limit(1);
    if (parent) {
      threadId = parent.threadId ?? null;
      replyToOutboundId = parent.id;
    }
  }
  // (b) Record fallback: thread onto the record's most recent email; if that
  //     latest message was an outbound, it's the one this reply answers.
  if (!threadId && (investorId || leadId)) {
    const [recent] = await tx
      .select({ id: communications.id, threadId: communications.threadId, direction: communications.direction })
      .from(communications)
      .where(and(eq(communications.tenantId, tenantId), eq(communications.channel, "email"), investorId ? eq(communications.investorId, investorId) : eq(communications.leadId, leadId!)))
      .orderBy(desc(communications.createdAt))
      .limit(1);
    if (recent?.threadId) threadId = recent.threadId;
    if (!replyToOutboundId && recent?.direction === "outbound") replyToOutboundId = recent.id;
  }
  if (!threadId) threadId = uuid();

  await tx.insert(communications).values({
    tenantId,
    // Attribute mail received on an RM's personal mailbox to that RM.
    userId: ownerUserId,
    channel: "email",
    direction: "inbound",
    investorId,
    leadId,
    externalId,
    status: "delivered",
    threadId,
    messageId: m.messageId,
    inReplyTo: m.inReplyTo,
    emailReferences: m.references,
    inboundContent: {
      from: m.from,
      fromName: m.fromName,
      subject: m.subject,
      text: m.text,
      // The raw HTML body is deliberately NOT stored, only whether there
      // was one.
      //
      // Nothing ever rendered it: its single reader was a truthiness check
      // in /api/comms/email-thread that swaps in the string "(HTML email —
      // open to view)". Meanwhile it had grown to 2,315 MB across 129,393
      // rows — 64% of the whole database, one row holding 13 MB — on an
      // instance with 88 MB of shared_buffers, so it was evicting genuinely
      // hot data and making every page slow for every firm.
      //
      // Mailback ZIPs arrive as attachments and are handled separately; the
      // plain-text part is kept because the inbox preview does render it.
      hasHtml: m.hasHtml,
      messageId: m.messageId,
      receivedAt: m.receivedAt,
    },
  } as any);

  // Mark the answered outbound 'replied' (don't regress a terminal state).
  if (replyToOutboundId) {
    await tx
      .update(communications)
      .set({ status: "replied", repliedAt: new Date() })
      .where(and(eq(communications.id, replyToOutboundId), inArray(communications.status, ["sent", "delivered", "read"])));
  }

  // Email → Service Request auto-routing (parity with WhatsApp intake). Its own
  // savepoint: it swallows its errors, and a swallowed SQL error would
  // otherwise leave this message's savepoint aborted and lose the email too.
  await tx
    .transaction((sp) =>
      maybeRouteEmailToTicket(sp, {
        tenantId,
        investorId,
        subject: m.subject,
        text: m.text,
        messageId: ref,
      })
    )
    .catch(() => undefined);
}

type MailboxRow = { id: string; tenantId: string; userId: string | null; encryptedConfig: string };

/** Poll one mailbox: fetch since its high-water UID, store, persist its state. */
async function pollMailbox(row: MailboxRow): Promise<void> {
  let config: any;
  try {
    config = JSON.parse(decrypt(row.encryptedConfig));
  } catch {
    return; // can't decrypt (key rotated?) — skip, not fatal
  }

  const oauth = config?.oauth as { provider?: OAuthProvider; refreshToken?: string; email?: string } | undefined;
  const imap = config?.imap ?? {};
  const lastUid = Number(imap.lastUid ?? 0);

  // Build the IMAP connection — password mailbox or OAuth (XOAUTH2).
  let cfg: ImapConfig | null = null;
  let rotatedRefresh: string | undefined;
  if (oauth?.provider && oauth.refreshToken) {
    try {
      const t = await refreshAccessToken(oauth.provider, oauth.refreshToken);
      rotatedRefresh = t.refreshToken;
      const def = getProviderDef(oauth.provider);
      cfg = {
        host: imap.host || def.imap.host,
        port: Number(imap.port ?? def.imap.port),
        secure: imap.secure ?? def.imap.secure,
        user: oauth.email || imap.user || "",
        pass: "",
        accessToken: t.accessToken,
      };
    } catch (e) {
      captureError("[imap] OAuth refresh failed — mailbox disconnected", e, { tenantId: row.tenantId, userId: row.userId ?? "firm" });
      return;
    }
  } else if (imap.host && imap.user && imap.pass) {
    cfg = { host: imap.host, port: Number(imap.port), secure: !!imap.secure, user: imap.user, pass: imap.pass };
  }
  if (!cfg) return; // no IMAP configured on this mailbox

  let msgs: InboundEmail[];
  try {
    msgs = await imapFetchSince(cfg, lastUid);
  } catch (e) {
    // Log the actionable reason (imapflow's bare "Command failed" is almost
    // always a rejected login — provider needs an app-specific password +
    // IMAP enabled), not the cryptic raw message.
    console.error(`[imap] ${row.tenantId}/${row.userId ?? "firm"} fetch failed: ${describeMailError(e, "imap")} (raw: ${(e as Error).message})`);
    return;
  }

  const who = `${row.tenantId}/${row.userId ?? "firm"}`;
  // Consecutive whole-batch failures at this UID. After MAX_TRANSIENT_STREAK
  // a still-failing message is held instead of retried, so no mailbox can
  // loop on the same message forever.
  const streak = imap.failStreak?.uid === lastUid ? Number(imap.failStreak.count ?? 0) : 0;
  let result: IngestResult | null = null;
  let failedBatch = false;
  if (msgs.length) {
    try {
      result = await ingest(row.tenantId, msgs, row.userId ?? null, streak >= MAX_TRANSIENT_STREAK);
    } catch (e) {
      // Transient (connection / timeout / deadlock): keep the high-water
      // mark; the batch is retried next poll. Log the code only — a
      // query error's message carries the insert's parameters (mail).
      failedBatch = true;
      const { code } = pgErrorOf(e);
      console.error(`[imap] ${who}: batch failed (${code ?? "no pg code"}), will retry from uid ${lastUid}; streak ${streak + 1}`);
      captureError("[imap] inbound batch failed", new Error(`pg ${code ?? "n/a"}`), { tenantId: row.tenantId, mailbox: row.id, lastUid, streak: streak + 1 });
    }
  }

  // Persist, scoped to THIS row's id (a tenant can have several mailbox
  // rows): the new high-water UID, held messages, the failure streak, and
  // any rotated OAuth refresh token — even when the batch failed, or a
  // rotated token would be lost.
  const maxUid = result?.maxUid ?? 0;
  const advanced = maxUid > lastUid;
  const held = result?.held ?? [];
  const nextStreak = failedBatch ? { uid: lastUid, count: streak + 1 } : undefined;
  const streakChanged = (imap.failStreak ? JSON.stringify(imap.failStreak) : undefined) !== (nextStreak ? JSON.stringify(nextStreak) : undefined);
  if (advanced || held.length || streakChanged || rotatedRefresh) {
    const nextImap: any = { ...imap };
    if (advanced) nextImap.lastUid = maxUid;
    if (held.length) {
      const at = new Date().toISOString();
      nextImap.held = [...(Array.isArray(imap.held) ? imap.held : []), ...held.map((h) => ({ ...h, at }))].slice(-MAX_HELD_RECORDED);
    }
    if (nextStreak) nextImap.failStreak = nextStreak;
    else delete nextImap.failStreak;
    config.imap = nextImap;
    if (rotatedRefresh && oauth) config.oauth = { ...oauth, refreshToken: rotatedRefresh };
    const enc = encrypt(JSON.stringify(config));
    await withTenant(row.tenantId, async (tx) => {
      await tx
        .update(tenantIntegrations)
        .set({ encryptedConfig: enc, updatedAt: new Date() })
        .where(eq(tenantIntegrations.id, row.id));
    });
  }
  for (const h of held) {
    // Safe internal identifier only: mailbox row, UID, a hash of the
    // Message-ID and the Postgres code. Never subject, body or address.
    console.error(`[imap] ${who}: HELD message uid ${h.uid} ref ${h.ref} (${h.reason}${h.code ? ` pg ${h.code}` : ""}${h.constraint ? ` ${h.constraint}` : ""}) — not stored; mailbox continues`);
    captureError("[imap] inbound message held", new Error(`${h.reason} ${h.code ?? ""}`.trim()), { tenantId: row.tenantId, mailbox: row.id, uid: h.uid, ref: h.ref });
  }
  if (result?.ingested || result?.skippedDuplicates) {
    console.log(
      `[imap] ${who}: ingested ${result.ingested}` +
        (result.storedWithoutExternalId ? ` (${result.storedWithoutExternalId} already held by another firm: stored without external_id)` : "") +
        (result.skippedDuplicates ? `, ${result.skippedDuplicates} already stored` : "") +
        `, uid→${maxUid}`
    );
  }
}

export function startImapPollerWorker() {
  const interval = Number(process.env.IMAP_POLLER_INTERVAL_MS ?? 120_000);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Every mailbox row — firm-wide (user_id NULL) AND each RM's personal one.
      const rows = await withSystem(async (tx) =>
        tx
          .select({
            id: tenantIntegrations.id,
            tenantId: tenantIntegrations.tenantId,
            userId: tenantIntegrations.userId,
            encryptedConfig: tenantIntegrations.encryptedConfig,
          })
          .from(tenantIntegrations)
          .where(and(eq(tenantIntegrations.provider, "mailbox"), eq(tenantIntegrations.isActive, true)))
          .limit(500)
      );

      for (const row of rows) {
        try {
          await pollMailbox(row);
        } catch (e) {
          // One mailbox must never stop the others from being polled.
          console.error(`[imap] ${row.tenantId}/${row.userId ?? "firm"}: mailbox poll failed (${pgErrorOf(e).code ?? (e as Error)?.name ?? "error"})`);
          captureError("[imap] mailbox poll failed", new Error(`pg ${pgErrorOf(e).code ?? "n/a"}`), { tenantId: row.tenantId, mailbox: row.id });
        }
      }
    } catch (e) {
      captureError("[imap] poller tick failed", new Error((e as Error)?.name ?? "error"), { code: pgErrorOf(e).code ?? null });
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, interval);
  console.log(`[imap] inbox poller started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
