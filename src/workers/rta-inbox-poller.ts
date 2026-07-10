/**
 * RTA mailback inbox poller.
 *
 * Polls ONE catch-all mailbox (RTA_INBOX_*) that every MFD auto-forwards their
 * daily CAMS/KFintech mailback email to. For each new message:
 *
 *   1. Resolve the tenant from the recipient address (rta_forward_addresses).
 *   2. Auto-capture any Gmail/Outlook forwarding-confirmation code for the UI.
 *   3. Classify each attachment by report-code + sender → (source, kind).
 *   4. Push the (still password-protected) attachment to S3 and enqueue the
 *      SAME rta.import job the manual upload route uses — which unzips (with the
 *      firm's stored CAMS/KFintech password), auto-detects, imports, and dedupes.
 *
 * Nothing here parses the file: it reuses the existing worker end-to-end. The
 * only new work is the inbound-email → attachment → S3 → enqueue bridge.
 *
 * Idempotency: messages are marked \Seen after handling; attachments dedupe on
 * sha256 vs prior rta_file_imports rows; unroutable mail is quarantined, never
 * dropped.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import {
  processUnseenMailback,
  type ImapConfig,
  type InboundRawMessage,
  type InboundAttachment,
} from "@/lib/comms/imap";
import { describeMailError } from "@/lib/comms/connection-error";
import { putObject } from "@/lib/storage/s3";
import { Q } from "./queues";
import { classifyMailback, isImportableAttachment, type MailbackClass } from "@/lib/rta/classify-mailback";
import {
  getMailbackPasswords,
  resolveTenantByAddresses,
  stampReceived,
  recordForwardingConfirmation,
  type MailbackPasswords,
} from "@/lib/rta/mailback-config";
import { loadRtaInboxConfig } from "@/lib/rta/inbox-config";
import { captureError } from "@/lib/observability/capture";

// Background imports have no human uploader. A stable sentinel enables the
// worker's stalled-job idempotency guard (importAlreadyFinished needs a truthy
// userId) while `uploaded_by` on the row stays NULL. It only sets a Postgres
// session var; no FK, and RLS scopes by tenant_id, not user.
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Detect (and extract the code/link from) a Gmail/Outlook forwarding-confirm mail. */
function detectForwardingConfirmation(msg: InboundRawMessage): { code: string | null; url: string | null } | null {
  const from = (msg.from ?? "").toLowerCase();
  const subj = msg.subject ?? "";
  const body = msg.text ?? "";
  const blob = `${subj}\n${body}`;
  const isForwarding =
    from.includes("forwarding-noreply@google.com") ||
    (/forward/i.test(subj) && /confirm|verif/i.test(blob)) ||
    (from.includes("microsoft") && /forward/i.test(blob));
  if (!isForwarding) return null;
  const code = blob.match(/\b(\d{6,10})\b/)?.[1] ?? null;
  const url =
    (blob.match(/https?:\/\/\S*(?:confirm|verif|forward)\S*/i)?.[0] ?? body.match(/https?:\/\/\S+/i)?.[0] ?? null)
      ?.replace(/[)\].,'">]+$/, "") ?? null;
  return { code, url };
}

async function quarantine(msg: InboundRawMessage, reason: string): Promise<void> {
  try {
    await withSystem(async (tx) => {
      await tx.execute(sql`
        INSERT INTO rta_inbound_quarantine (to_address, from_address, subject, message_id, reason, received_at)
        VALUES (
          ${msg.recipients[0] ?? null}, ${msg.from ?? null}, ${msg.subject ?? null},
          ${msg.messageId ?? null}, ${reason}, ${msg.date ?? null}
        )
      `);
    });
  } catch (e) {
    captureError("[rta-inbox] quarantine insert failed", e, { reason });
  }
  console.warn(`[rta-inbox] quarantined mail from ${msg.from ?? "?"} (${reason})`);
}

/** Upload one attachment to S3 + enqueue the matching rta.import job. */
async function ingestAttachment(
  tenantId: string,
  msg: InboundRawMessage,
  att: InboundAttachment,
  cls: MailbackClass,
  pw: MailbackPasswords
): Promise<"queued" | "duplicate"> {
  const checksum = createHash("sha256").update(att.content).digest("hex");

  // Dedupe — same file already imported (or in flight) for this tenant/kind.
  // Re-forwarding yesterday's mail, or an overlapping poll, is a no-op.
  const dup = await withTenant(tenantId, async (tx) =>
    tx.execute(sql`
      SELECT id FROM rta_file_imports
      WHERE tenant_id = ${tenantId}::uuid AND source = ${cls.source} AND kind = ${cls.kind}
        AND file_checksum = ${checksum}
        AND status IN ('completed', 'partial', 'parsing', 'uploaded')
      LIMIT 1
    `)
  );
  if (dup.rows.length) {
    console.log(`[rta-inbox] ${tenantId}: '${att.filename}' already imported — skipped (duplicate)`);
    return "duplicate";
  }

  const safe = att.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const key = `tenants/${tenantId}/rta/${Date.now()}-${safe}`;
  await putObject(key, att.content, att.contentType || "application/octet-stream");

  const password = (cls.source === "cams" ? pw.camsPassword : pw.kfintechPassword) || undefined;

  const importId = await withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      INSERT INTO rta_file_imports (
        tenant_id, source, kind, period_start, period_end,
        file_name, file_key, file_size_bytes, file_checksum, status, remarks
      ) VALUES (
        ${tenantId}::uuid, ${cls.source}, ${cls.kind}, ${today()}::date, ${today()}::date,
        ${att.filename}, ${key}, ${att.size}, ${checksum}, 'uploaded',
        ${`Auto-imported from forwarded email (${msg.from ?? "unknown sender"})`}
      )
      RETURNING id
    `);
    return (r.rows[0] as any).id as string;
  });

  const jobOpts = { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } } as const;
  if (cls.isRich) {
    // Master / holdings → the rich engine that builds the client book.
    await Q.rtaImport().add(
      "rich-import",
      {
        mode: "rich",
        importId,
        tenantId,
        key,
        filename: att.filename,
        password,
        rta: cls.source,
        reportType: "",
        dryRun: false,
        assignToMe: false,
        userId: SYSTEM_USER,
        roles: [],
      },
      jobOpts
    );
  } else {
    // Daily feed / brokerage / AUM / SIP-rejection / mandate → feed processor.
    await Q.rtaImport().add(
      "import",
      {
        importId,
        tenantId,
        source: cls.source,
        kind: cls.kind,
        key,
        filename: att.filename,
        password,
        userId: SYSTEM_USER,
        roles: [],
      },
      jobOpts
    );
  }
  console.log(`[rta-inbox] ${tenantId}: queued ${cls.label} '${att.filename}' (${att.size}b) → ${importId}`);
  return "queued";
}

async function handleMessage(msg: InboundRawMessage): Promise<void> {
  // 1. Route to a tenant by the address the mail was forwarded to.
  const match = await withSystem(async (tx) => resolveTenantByAddresses(tx, msg.recipients));
  if (!match) {
    await quarantine(msg, "no matching forwarding address");
    return;
  }
  const tenantId = match.tenantId;

  // 2. Stamp receipt + capture any forwarding-confirmation code for the UI.
  const confirm = detectForwardingConfirmation(msg);
  await withTenant(tenantId, async (tx) => {
    await stampReceived(tx, match.id);
    if (confirm) await recordForwardingConfirmation(tx, match.id, confirm.code, confirm.url);
  });
  // A pure Gmail/Outlook verification email carries no importable data.
  if (confirm && msg.attachments.length === 0) {
    console.log(`[rta-inbox] ${tenantId}: captured forwarding confirmation${confirm.code ? ` (code ${confirm.code})` : ""}`);
    return;
  }

  // 3. Load the firm's CAMS + KFintech ZIP passwords once.
  const pw = await withTenant(tenantId, async (tx) => getMailbackPasswords(tx, tenantId));

  // 4. Ingest each recognised attachment. Track outcomes so we only quarantine
  //    mail we genuinely couldn't use — a recognised-but-already-imported file
  //    (dedup) is a legitimate no-op, NOT junk to quarantine.
  let queued = 0;
  let duplicates = 0;
  let recognised = 0;
  for (const att of msg.attachments) {
    if (!isImportableAttachment(att.filename)) continue;
    const cls = classifyMailback(att.filename, msg.from);
    if (!cls) {
      console.warn(`[rta-inbox] ${tenantId}: unrecognised attachment '${att.filename}' from ${msg.from ?? "?"} — skipped`);
      continue;
    }
    recognised++;
    try {
      const res = await ingestAttachment(tenantId, msg, att, cls, pw);
      if (res === "queued") queued++;
      else if (res === "duplicate") duplicates++;
    } catch (e) {
      captureError("[rta-inbox] attachment ingest failed", e, { tenantId, filename: att.filename });
    }
  }

  if (queued > 0) return; // something imported — done
  if (recognised > 0) {
    // Recognised but nothing new to import (all duplicates of prior imports).
    // A no-op, not junk — do NOT quarantine.
    console.log(`[rta-inbox] ${tenantId}: ${duplicates} attachment(s) already imported — no new import (no-op)`);
    return;
  }
  // Nothing recognised at all (and not a forwarding-confirmation) → quarantine.
  if (!confirm) {
    await quarantine(msg, "routed to tenant but no importable RTA attachment recognised");
  }
}

export function startRtaInboxPollerWorker() {
  const interval = Number(process.env.RTA_INBOX_POLLER_INTERVAL_MS ?? 120_000);
  let running = false;
  let warnedIdle = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // The inbox config lives in Aina Admin (platform_settings, env fallback)
      // and is re-read each tick (60s-cached) — so enabling/changing it in the
      // admin panel takes effect within one interval, no worker restart needed.
      const rc = await loadRtaInboxConfig();
      if (!rc.configured) {
        if (!warnedIdle) {
          console.log("[rta-inbox] inbox not configured (Aina Admin → RTA Mailbox, or RTA_INBOX_* env) — poller idle");
          warnedIdle = true;
        }
        return;
      }
      warnedIdle = false;
      const cfg: ImapConfig = { host: rc.host!, port: rc.port, secure: rc.secure, user: rc.user!, pass: rc.pass! };
      const { processed } = await processUnseenMailback(cfg, handleMessage);
      if (processed) console.log(`[rta-inbox] processed ${processed} message(s) (domain=${rc.domain})`);
    } catch (e) {
      console.error(`[rta-inbox] poll failed: ${describeMailError(e, "imap")} (raw: ${(e as Error).message})`);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, interval);
  handle.unref?.();
  console.log(`[rta-inbox] mailback poller started (interval=${interval}ms; config from Aina Admin)`);
  return () => clearInterval(handle);
}
