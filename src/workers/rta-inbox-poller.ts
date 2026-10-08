/**
 * RTA mailback inbox poller.
 *
 * Polls ONE catch-all mailbox (RTA_INBOX_*) that every MFD auto-forwards their
 * daily CAMS/KFintech mailback email to. For each new message:
 *
 *   1. Resolve the tenant from the recipient ALIAS (rta_forward_addresses).
 *      A match on forwarder / From headers alone is quarantined, never
 *      imported (lib/rta/mail-trust explains why).
 *   2. Auto-capture any Gmail/Outlook forwarding-confirmation code for the UI —
 *      its link only from a confirmation authenticated as the provider.
 *   3. Classify each attachment by report-code + sender → (source, kind).
 *   4. Require evidence the mail is genuine — registrar DKIM/DMARC pass in OUR
 *      server's Authentication-Results — else quarantine it. (A decrypting
 *      archive is not sender authentication: lib/rta/mail-trust.ts.)
 *   5. Push the (still password-protected) attachment to S3 and enqueue the
 *      SAME rta.import job the manual upload route uses — which unzips (with the
 *      firm's stored CAMS/KFintech password), auto-detects, imports, and dedupes.
 *
 * Nothing here parses the file: it reuses the existing worker end-to-end. The
 * only new work is the inbound-email → attachment → S3 → enqueue bridge.
 *
 * Idempotency: messages are marked \Seen after handling (\Flagged, not \Seen,
 * when storing / queuing failed); attachments dedupe on sha256 vs in-flight
 * rta_file_imports rows; unroutable and quarantined mail is logged and (SES)
 * held for retry, never dropped.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { recordRun } from "./scheduler-state";
import {
  processUnseenMailback,
  deleteMessagesByMessageId,
  type ImapConfig,
  type InboundRawMessage,
  type InboundAttachment,
} from "@/lib/comms/imap";
import { describeMailError } from "@/lib/comms/connection-error";
import { putObject } from "@/lib/storage/s3";
import { Q } from "./queues";
import {
  classifyMailback,
  classifyMailbackFromText,
  isImportableAttachment,
  type MailbackClass,
} from "@/lib/rta/classify-mailback";
import { extractRtaDownloadLinks, fetchRtaDownload } from "@/lib/rta/mailback-download";
import {
  getMailbackPasswords,
  passwordsToTry,
  resolveTenantByAddresses,
  resolveTenantBySenders,
  stampReceived,
  recordForwardingConfirmation,
  type MailbackPasswords,
} from "@/lib/rta/mailback-config";
import { loadRtaInboxConfig } from "@/lib/rta/inbox-config";
import { attachmentTrust, evaluateMailAuth, safeConfirmationUrl } from "@/lib/rta/mail-trust";
import { captureError } from "@/lib/observability/capture";

// Background imports have no human uploader. A stable sentinel enables the
// worker's stalled-job idempotency guard (importAlreadyFinished needs a truthy
// userId) while `uploaded_by` on the row stays NULL. It only sets a Postgres
// session var; no FK, and RLS scopes by tenant_id, not user.
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Detect a Gmail/Outlook forwarding-confirmation mail and pull out what we need:
 * the numeric code (when there is one), the confirm link, and — crucially — the
 * mailbox that REQUESTED the forward.
 *
 * That requester is the only firm-identifying data in the message: Google sends
 * this mail itself, so the From is forwarding-noreply@google.com and there is no
 * X-Forwarded-For to match on. Without pulling the requester out of the body, a
 * confirmation sent to the SHARED rta@ address can't be attributed to any firm.
 */
function detectForwardingConfirmation(
  msg: InboundRawMessage
): { code: string | null; url: string | null; requester: string | null } | null {
  const from = (msg.from ?? "").toLowerCase();
  const subj = msg.subject ?? "";
  const body = msg.text ?? "";
  const blob = `${subj}\n${body}`;
  const isForwarding =
    from.includes("forwarding-noreply@google.com") ||
    (/forward/i.test(subj) && /confirm|verif/i.test(blob)) ||
    (from.includes("microsoft") && /forward/i.test(blob));
  if (!isForwarding) return null;

  // Strip URLs BEFORE scanning for a code — Gmail's link-only mail ends with
  // "answer.py?answer=184973", and a naive \d{6,10} happily returns that
  // support-article id as if it were the confirmation code.
  const deUrled = blob.replace(/https?:\/\/\S+/gi, " ");
  const code =
    // Prefer a number explicitly labelled as the code.
    deUrled.match(/(?:confirmation\s+code|code)\D{0,20}(\d{6,10})/i)?.[1] ??
    deUrled.match(/\b(\d{6,10})\b/)?.[1] ??
    null;

  const url =
    (blob.match(/https?:\/\/\S*(?:\/vf-|confirm|verif|forward)\S*/i)?.[0] ?? body.match(/https?:\/\/\S+/i)?.[0] ?? null)
      ?.replace(/[)\].,'">]+$/, "") ?? null;

  // "<addr> has requested to automatically forward mail to your email address"
  // (body), or the subject "… Receive Mail from <addr>".
  const requester =
    body.match(/([\w.+-]+@[\w.-]+\.\w{2,})\s+has requested to automatically forward/i)?.[1] ??
    subj.match(/receive mail from\s+([\w.+-]+@[\w.-]+\.\w{2,})/i)?.[1] ??
    null;

  return { code, url, requester: requester?.toLowerCase() ?? null };
}

/** Per-attachment verdict recorded on the inbound-mail log row. */
type AttachmentLog = {
  filename: string;
  size: number;
  source: string | null;
  kind: string | null;
  outcome: "queued" | "duplicate" | "unrecognised" | "quarantined" | "error";
  importId?: string | null;
  reason?: string | null;
};

/**
 * `quarantined` (no evidence the mail is genuine, or routed only by forgeable
 * headers) is written to the free-text `outcome` column alongside the values
 * listed in schema/rta_inbound_messages.ts — no constraint restricts it.
 */
type InboundOutcome =
  | "imported"
  | "duplicate"
  | "confirmation"
  | "no_attachment"
  | "unroutable"
  | "quarantined"
  | "error";

/** Body text we keep for the admin log — enough to identify the mail, not the lot. */
const BODY_SNIPPET_MAX = 2000;

/**
 * Record EVERY message the poller touches — routed or not — so "did my forward
 * arrive?" is answerable from Aina Admin → Inbound Mail instead of the worker
 * logs. Best-effort: a logging failure must never stop an import.
 *
 * Upserts on message_id (globally unique per RFC 5322), so a message reprocessed
 * after a crash-before-\Seen refreshes its row rather than duplicating it.
 */
async function logInbound(
  msg: InboundRawMessage,
  fields: {
    tenantId?: string | null;
    forwardAddressId?: string | null;
    toAddress?: string | null;
    outcome: InboundOutcome;
    reason?: string | null;
    attachments?: AttachmentLog[];
    queued?: number;
    duplicates?: number;
  }
): Promise<void> {
  // Tell the caller what was decided — the S3 inbound reader keeps the stored
  // mail only when it could not be routed. Set before the insert so a failed
  // log write cannot hide the outcome.
  msg.outcome = fields.outcome;
  try {
    const atts = fields.attachments ?? [];
    await withSystem(async (tx) => {
      await tx.execute(sql`
        INSERT INTO rta_inbound_messages (
          tenant_id, forward_address_id, message_id, from_address, from_name,
          to_address, recipients, subject, body_snippet, received_at,
          outcome, reason, attachment_count, queued_count, duplicate_count, attachments
        ) VALUES (
          ${fields.tenantId ?? null}, ${fields.forwardAddressId ?? null},
          ${msg.messageId ?? null}, ${msg.from ?? null}, ${msg.fromName ?? null},
          ${fields.toAddress ?? msg.recipients[0] ?? null},
          ${JSON.stringify(msg.recipients ?? [])}::jsonb,
          ${msg.subject ?? null}, ${(msg.text ?? "").slice(0, BODY_SNIPPET_MAX) || null},
          ${msg.date ?? null}, ${fields.outcome}, ${fields.reason ?? null},
          ${msg.attachments.length}, ${fields.queued ?? 0}, ${fields.duplicates ?? 0},
          ${JSON.stringify(atts)}::jsonb
        )
        ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          forward_address_id = EXCLUDED.forward_address_id,
          outcome = EXCLUDED.outcome,
          reason = EXCLUDED.reason,
          attachment_count = EXCLUDED.attachment_count,
          queued_count = EXCLUDED.queued_count,
          duplicate_count = EXCLUDED.duplicate_count,
          attachments = EXCLUDED.attachments
      `);
    });
  } catch (e) {
    captureError("[rta-inbox] inbound log insert failed", e, { outcome: fields.outcome });
  }
}

async function quarantine(msg: InboundRawMessage, reason: string): Promise<void> {
  await logInbound(msg, { outcome: "unroutable", reason });
  console.warn(`[rta-inbox] quarantined mail from ${msg.from ?? "?"} (${reason})`);
}

/** Upload one attachment to S3 + enqueue the matching rta.import job. */
async function ingestAttachment(
  tenantId: string,
  msg: InboundRawMessage,
  att: InboundAttachment,
  cls: MailbackClass,
  pw: MailbackPasswords
): Promise<{ status: "queued" | "duplicate"; importId: string | null }> {
  const checksum = createHash("sha256").update(att.content).digest("hex");

  // Guard only against a file that is STILL IN FLIGHT (uploaded/parsing) for this
  // tenant/kind — prevents an overlapping poll from double-enqueuing the same job.
  // A previously completed/partial/failed import is deliberately NOT skipped: the
  // downstream import upserts (overwrites folios/transactions in place), so every
  // re-forward refreshes the book to the LATEST data. Idempotency-by-skip would
  // stop a re-sent file from ever refreshing, which is not what MFDs want.
  const dup = await withTenant(tenantId, async (tx) =>
    tx.execute(sql`
      SELECT id FROM rta_file_imports
      WHERE tenant_id = ${tenantId}::uuid AND source = ${cls.source} AND kind = ${cls.kind}
        AND file_checksum = ${checksum}
        AND status IN ('parsing', 'uploaded')
      LIMIT 1
    `)
  );
  if (dup.rows.length) {
    console.log(`[rta-inbox] ${tenantId}: '${att.filename}' already in flight — skipped (duplicate)`);
    return { status: "duplicate", importId: (dup.rows[0] as any).id as string };
  }

  const safe = att.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const key = `tenants/${tenantId}/rta/${Date.now()}-${safe}`;
  await putObject(key, att.content, att.contentType || "application/octet-stream");

  // Every password this firm has saved, tried in order until one opens the
  // archive — a firm with more than one ARN can have more than one mailback
  // subscription (and password) per registrar, and the registrar a password
  // is saved under is not always the one whose files it opens.
  const passwords = passwordsToTry(pw, cls.source);

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
        passwords,
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
        passwords,
        userId: SYSTEM_USER,
        roles: [],
      },
      jobOpts
    );
  }
  console.log(`[rta-inbox] ${tenantId}: queued ${cls.label} '${att.filename}' (${att.size}b) → ${importId}`);
  return { status: "queued", importId };
}

async function handleMessage(msg: InboundRawMessage): Promise<void> {
  // Detected up-front: a Gmail confirmation is the one message whose firm
  // identity lives in the BODY rather than in any header (see below).
  const confirm = detectForwardingConfirmation(msg);
  // What our own receiving server says about the sender (lib/rta/mail-trust):
  // only the topmost Authentication-Results, and only from SES / the configured
  // IMAP host, is believed.
  const auth = evaluateMailAuth(msg.authResults, msg.transport, msg.from);
  const confirmAuthentic = !!confirm && !!auth.confirmationDomain;

  // 1. Route to a tenant. Only two paths can ROUTE:
  //    a) the per-firm alias rta-<token>@<domain> the mail was addressed to —
  //       an unguessable, rotatable token, the only routing credential;
  //    b) for a forwarding confirmation AUTHENTICATED as Google / Microsoft
  //       (DKIM covers the body), the mailbox the body says requested the
  //       forward. Google sends that mail itself, so without this a
  //       confirmation for the shared address could never reach its firm.
  //    The forwarder / From headers (the old path for the shared rta@ address)
  //    are still LOOKED UP, but only to explain the quarantine: anyone can write
  //    those headers, so a match on them never imports anything.
  const resolved = await withSystem(async (tx) => {
    const byAlias = await resolveTenantByAddresses(tx, msg.recipients);
    if (byAlias) return { row: byAlias, via: "alias" as const, ambiguous: false };

    if (confirm?.requester && confirmAuthentic) {
      const byReq = await resolveTenantBySenders(tx, [confirm.requester]);
      if (byReq.row) return { row: byReq.row, via: "confirm-requester" as const, ambiguous: false };
    }

    const bySender = await resolveTenantBySenders(tx, msg.senderCandidates);
    if (bySender.row) return { row: bySender.row, via: "sender" as const, ambiguous: false };
    return { row: null, via: "sender" as const, ambiguous: bySender.ambiguous };
  });

  const match = resolved.row;
  if (!match || resolved.via === "sender") {
    if (confirm) {
      // An AUTHENTICATED but unattributable confirmation is logged as a
      // confirmation (tenant NULL) — registering the requesting mailbox later
      // claims it (attachPendingConfirmations). An unauthenticated one is
      // quarantined, so its link can never be attached to any firm's card.
      if (confirmAuthentic) {
        await logInbound(msg, {
          outcome: "confirmation",
          reason:
            `Forwarding confirmation from ${confirm.requester ?? "an unknown mailbox"} — could NOT be matched to a firm. ` +
            `Register that mailbox on the firm's RTA Mailback card, then re-send the confirmation.` +
            (confirm.code ? ` Code: ${confirm.code}.` : " Use the confirmation link in the body below."),
        });
      } else {
        await logInbound(msg, {
          outcome: "quarantined",
          reason:
            `Quarantined — looks like a forwarding confirmation, but it is not authenticated as Google / Microsoft ` +
            `(${auth.headerNote}) and was not sent to a firm's rta-<token>@ alias, so it was not attributed and its link is never shown.`,
        });
      }
      console.warn(`[rta-inbox] forwarding confirmation not attributable to a firm — see Inbound Mail`);
      return;
    }
    if (match) {
      // Header-only match: quarantined, never imported. Platform-admin visible
      // (tenant NULL — the attribution is unverified).
      await logInbound(msg, {
        outcome: "quarantined",
        reason:
          `Quarantined — not addressed to any firm's rta-<token>@ alias. The forwarder/From headers match the mailbox ` +
          `registered by firm ${match.tenantId}, but those headers can be forged, so nothing was imported. ` +
          `The firm should forward to its own rta-<token>@ address.`,
      });
      console.warn(`[rta-inbox] quarantined header-routed mail from ${msg.from ?? "?"}`);
      return;
    }
    await quarantine(
      msg,
      resolved.ambiguous
        ? "sender mailbox is registered by more than one firm — not routed (use the firm's own rta-<token>@ address)"
        : "no matching forwarding address — mail must be sent to the firm's own rta-<token>@ address"
    );
    return;
  }
  if (resolved.via === "confirm-requester") {
    console.log(`[rta-inbox] ${match.tenantId}: authenticated forwarding confirmation matched via requesting mailbox`);
  }
  const tenantId = match.tenantId;
  // Everything from here on is attributable to a firm, so any failure is logged
  // against that firm rather than vanishing into the worker log.
  const logBase = { tenantId, forwardAddressId: match.id, toAddress: match.address ?? null };

  try {
    // 2. Stamp receipt + capture any forwarding-confirmation code for the UI.
    //    The clickable LINK is kept only from an authenticated confirmation and
    //    only when it points at the provider itself; an unauthenticated one sent
    //    to the alias contributes its numeric code at most.
    await withTenant(tenantId, async (tx) => {
      await stampReceived(tx, match.id);
      if (confirm) {
        await recordForwardingConfirmation(
          tx,
          match.id,
          confirm.code,
          confirmAuthentic ? safeConfirmationUrl(confirm.url) : null
        );
      }
    });
    // A pure Gmail/Outlook verification email carries no importable data.
    if (confirm && msg.attachments.length === 0) {
      console.log(`[rta-inbox] ${tenantId}: captured forwarding confirmation${confirm.code ? ` (code ${confirm.code})` : ""}`);
      await logInbound(msg, {
        ...logBase,
        outcome: "confirmation",
        reason:
          (confirm.code ? `Forwarding confirmation code ${confirm.code}` : "Forwarding confirmation") +
          (confirmAuthentic ? "" : " (not authenticated — link not shown)"),
      });
      return;
    }

    // 3. Load the firm's CAMS + KFintech ZIP passwords once.
    const pw = await withTenant(tenantId, async (tx) => getMailbackPasswords(tx, tenantId));

    // 4. Ingest each recognised attachment that carries evidence it is genuine
    //    (registrar-authenticated mail). Track outcomes so the log says what really happened: a file
    //    already in flight is a no-op, an unproven one is quarantined, and a
    //    store / queue failure is an ERROR — never "already imported".
    let queued = 0;
    let duplicates = 0;
    let recognised = 0;
    let quarantined = 0;
    let errors = 0;
    const attLogs: AttachmentLog[] = [];

    /** Trust check + ingest for one file; records its verdict. True when queued. */
    const admitAndIngest = async (
      file: InboundAttachment,
      cls: MailbackClass,
      okNote: string | null
    ): Promise<boolean> => {
      const trust = await attachmentTrust(file.content, auth, passwordsToTry(pw, cls.source));
      if (!trust.admit) {
        quarantined++;
        attLogs.push({
          filename: file.filename, size: file.size, source: cls.source, kind: cls.kind,
          outcome: "quarantined", reason: trust.reason,
        });
        return false;
      }
      try {
        const res = await ingestAttachment(tenantId, msg, file, cls, pw);
        if (res.status === "queued") queued++;
        else duplicates++;
        attLogs.push({
          filename: file.filename, size: file.size, source: cls.source, kind: cls.kind,
          outcome: res.status, importId: res.importId,
          reason: res.status === "duplicate" ? "Same file already being imported" : [okNote, trust.note].filter(Boolean).join(" · "),
        });
        return res.status === "queued";
      } catch (e) {
        errors++;
        captureError("[rta-inbox] attachment ingest failed", e, { tenantId, filename: file.filename });
        attLogs.push({
          filename: file.filename, size: file.size, source: cls.source, kind: cls.kind,
          outcome: "error", reason: (e as Error)?.message ?? "ingest failed",
        });
        return false;
      }
    };

    for (const att of msg.attachments) {
      if (!isImportableAttachment(att.filename)) continue;
      const cls = classifyMailback(att.filename, msg.from);
      if (!cls) {
        console.warn(`[rta-inbox] ${tenantId}: unrecognised attachment '${att.filename}' from ${msg.from ?? "?"} — skipped`);
        attLogs.push({
          filename: att.filename,
          size: att.size,
          source: null,
          kind: null,
          outcome: "unrecognised",
          reason: "Filename carries no recognised CAMS/KFintech report code",
        });
        continue;
      }
      recognised++;
      await admitAndIngest(att, cls, null);
    }

    // 5. LINK-delivered reports. Above a certain size neither registrar attaches
    //    the ZIP — CAMS mails a `DownloadURL` (Request Status: Link) and
    //    KFintech a "Click Here" anchor. Those mails have zero attachments, so
    //    without this the biggest reports (the daily feeds) never import.
    //    Only attempted when no attachment already produced an import. The
    //    downloaded file passes the same evidence check as an attachment.
    if (queued === 0) {
      const links = extractRtaDownloadLinks(msg.text, msg.html);
      for (const link of links.slice(0, 3)) {
        const dl = await fetchRtaDownload(link);
        if (!dl.ok) {
          // A failed download is an error, not "no attachment": the mail is kept
          // (not deleted / not marked read) so it can be looked at and retried.
          errors++;
          console.warn(`[rta-inbox] ${tenantId}: download skipped (${dl.reason}) — ${link.slice(0, 80)}`);
          attLogs.push({ filename: link.slice(0, 200), size: 0, source: null, kind: null, outcome: "error", reason: dl.reason });
          continue;
        }
        // The downloaded name is usually an opaque token that still ends in the
        // report code (…219432120R2.zip). When it doesn't classify, fall back to
        // the mail text, which states the report explicitly ("Report No: MFSD311").
        const cls =
          classifyMailback(dl.file.filename, msg.from) ??
          classifyMailbackFromText(msg.subject, `${msg.text ?? ""}\n${msg.html ?? ""}`, msg.from);
        if (!cls) {
          attLogs.push({
            filename: dl.file.filename,
            size: dl.file.size,
            source: null,
            kind: null,
            outcome: "unrecognised",
            reason: "Downloaded file, but neither its name nor the mail names a known report code",
          });
          continue;
        }
        recognised++;
        const host = (() => {
          try {
            return new URL(dl.file.url).hostname;
          } catch {
            return "registrar link";
          }
        })();
        if (await admitAndIngest(dl.file, cls, `Downloaded from ${host}`)) break; // one report per mail
      }
    }

    const logTail = { ...logBase, attachments: attLogs, queued, duplicates };

    if (queued > 0) {
      // Something imported. If another file of the same mail failed to store or
      // queue, keep the source copy so that one is not lost with it.
      if (errors > 0) msg.keepSource = true;
      await logInbound(msg, {
        ...logTail,
        outcome: "imported",
        reason: errors > 0 ? `${errors} other file(s) could not be stored or queued — see attachments; mail kept` : null,
      });
      return;
    }
    if (errors > 0) {
      // Every recognised file failed to store / queue (or download). This used
      // to be logged "duplicate — already imported" and the SES copy deleted.
      console.warn(`[rta-inbox] ${tenantId}: ${errors} file(s) could not be stored or queued — kept for inspection`);
      await logInbound(msg, {
        ...logTail,
        outcome: "error",
        reason: `${errors} file(s) could not be stored, downloaded or queued — nothing was imported; the mail is kept for inspection and retry`,
      });
      return;
    }
    if (quarantined > 0) {
      console.warn(`[rta-inbox] ${tenantId}: ${quarantined} file(s) quarantined — no evidence the mail came from the registrar`);
      await logInbound(msg, {
        ...logTail,
        outcome: "quarantined",
        reason:
          `Quarantined — ${quarantined} file(s) were not imported: the mail is not authenticated as a registrar ` +
          `(no registrar DKIM/DMARC pass from our receiving server). Review it in Inbound Mail.`,
      });
      return;
    }
    if (recognised > 0) {
      // Recognised, and every file is already being imported — a genuine no-op.
      console.log(`[rta-inbox] ${tenantId}: ${duplicates} attachment(s) already in flight — no new import (no-op)`);
      await logInbound(msg, { ...logTail, outcome: "duplicate", reason: "Already being imported — no new data" });
      return;
    }
    // Nothing recognised at all (and not a forwarding-confirmation).
    if (!confirm) {
      await logInbound(msg, {
        ...logTail,
        outcome: "no_attachment",
        reason: msg.attachments.length
          ? "No attachment matched a known CAMS/KFintech report code"
          : "Mail had no attachments, and no downloadable report link could be used (see per-link reasons)",
      });
      console.warn(`[rta-inbox] ${tenantId}: no importable RTA attachment recognised`);
    } else {
      await logInbound(msg, { ...logTail, outcome: "confirmation", reason: "Forwarding confirmation" });
    }
  } catch (e) {
    // Route-succeeded-but-processing-failed: record it against the firm so the
    // failure is visible in the admin log, then rethrow for the usual capture
    // (the S3 reader parks the mail; the IMAP reader flags it instead of \Seen).
    await logInbound(msg, { ...logBase, outcome: "error", reason: (e as Error)?.message ?? "handler failed" });
    throw e;
  }
}

/** The routing + trust decision for one message — exported for tests. */
export { handleMessage as handleRtaInboundMessage };

/**
 * Cleanup sweep — delete forwarded mail from the catch-all once it has been
 * imported, so the mailbox doesn't grow without bound.
 *
 * Safe because the attachment bytes were pushed to S3 BEFORE the import was
 * queued, and rta_inbound_messages keeps the audit trail (sender, subject, body
 * snippet, per-attachment verdict) after the mail itself is gone.
 *
 * A message is only eligible when EVERY attachment it queued has an import row
 * that actually finished (`completed`/`partial`). A failed import — wrong ZIP
 * password being the common case — therefore KEEPS its mail, so fixing the
 * password and re-running is still possible. Nothing else is ever touched:
 * unroutable, quarantined and errored mail stay put for a human to look at.
 */
async function sweepImportedMail(cfg: ImapConfig, retentionDays: number): Promise<number> {
  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT m.id, m.message_id
      FROM rta_inbound_messages m
      WHERE m.outcome = 'imported'
        AND m.mail_deleted_at IS NULL
        AND m.message_id IS NOT NULL
        AND m.created_at < now() - (${String(retentionDays)} || ' days')::interval
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(m.attachments) a
          WHERE a->>'outcome' = 'queued'
            AND COALESCE(
              (SELECT fi.status FROM rta_file_imports fi WHERE fi.id::text = a->>'importId'),
              'missing'
            ) NOT IN ('completed', 'partial')
        )
      ORDER BY m.created_at
      LIMIT 200
    `);
    return r.rows as unknown as Array<{ id: string; message_id: string }>;
  });
  if (!rows.length) return 0;

  const { deleted } = await deleteMessagesByMessageId(cfg, rows.map((r) => r.message_id));
  if (!deleted.length) return 0;

  // Stamp only what actually went, so a message that failed to delete is retried
  // next sweep rather than being silently marked clean.
  const byMid = new Map(rows.map((r) => [r.message_id, r.id]));
  const ids = deleted.map((mid) => byMid.get(mid)).filter(Boolean) as string[];
  await withSystem(async (tx) => {
    await tx.execute(sql`
      UPDATE rta_inbound_messages SET mail_deleted_at = now()
      WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
    `);
  });
  return deleted.length;
}

export async function pollRtaInboxOnce(): Promise<{ processed: number; configured: boolean; error?: string }> {
  try {
    const rc = await loadRtaInboxConfig();
    if (!rc.configured) {
      return { processed: 0, configured: false, error: "RTA mailbox credentials are not configured in Admin settings." };
    }
    const cfg: ImapConfig = { host: rc.host!, port: rc.port, secure: rc.secure, user: rc.user!, pass: rc.pass! };
    const { processed } = await processUnseenMailback(cfg, handleMessage);
    return { processed, configured: true };
  } catch (e: any) {
    const errDesc = describeMailError(e, "imap");
    return { processed: 0, configured: true, error: errDesc || e.message };
  }
}

// ── Amazon SES → S3 inbound ─────────────────────────────────────────────────
//
// The shared mailbox lived on Hostinger, which caps how many mails one mailbox
// accepts per hour. Registrars deliver in bursts, so it started answering
// `451 4.7.1 Ratelimit "hostinger_inc_ratelimit"`; Gmail retried, gave up and
// bounced, and reports were lost for every firm at once.
//
// SES receiving has no per-mailbox cap and no inbox to fill: a receipt rule
// writes each mail for crm.ainatech.in, raw, into the uploads bucket under
// INBOUND_PREFIX. This reader feeds those files through the SAME handleMessage
// the IMAP reader uses, so routing, unzip, passwords and import are unchanged.
//
// It also closes the hole where routing failure meant data loss: with IMAP the
// attachment was only stored once routing succeeded, so an unroutable mail kept
// its log row and lost its bytes. Here the mail is already in S3 before routing
// runs. If it cannot be routed it moves to HELD_PREFIX and is retried hourly, so
// registering the firm's forwarding mailbox later recovers it. The bucket's
// lifecycle rule deletes anything left in these folders after 30 days.
const INBOUND_PREFIX = "rta-inbound/";
const HELD_PREFIX = "rta-inbound-held/";
const FAILED_PREFIX = "rta-inbound-failed/";
const INBOUND_BATCH = 25;

async function readStoredMail(key: string, seq: number): Promise<InboundRawMessage> {
  const { getObjectBytes } = await import("@/lib/storage/s3");
  const { parseInboundSource } = await import("@/lib/comms/imap");
  return parseInboundSource(await getObjectBytes(key), seq, undefined, "ses");
}

/**
 * What to do with a stored SES mail once handleMessage has decided:
 *   hold   — unroutable or quarantined: retried hourly (a corrected alias or a
 *            confirmed REGISTRAR_DOMAINS entry can still admit it);
 *   park   — something failed to store / queue: kept under FAILED_PREFIX for a
 *            human, never silently deleted;
 *   delete — handled (imported, duplicate, confirmation, no_attachment).
 */
export function s3Disposition(msg: Pick<InboundRawMessage, "outcome" | "keepSource">): "hold" | "park" | "delete" {
  if (msg.outcome === "unroutable" || msg.outcome === "quarantined") return "hold";
  if (msg.outcome === "error" || msg.keepSource || !msg.outcome) return "park";
  return "delete";
}

/**
 * Drain new mail from S3. A routed mail is deleted (its attachments are already
 * stored per firm by ingestAttachment); an unroutable one is held; a mail the
 * handler threw on is parked under FAILED_PREFIX so it can't loop every tick.
 */
export async function pollS3InboundOnce(): Promise<{ processed: number; held: number; failed: number }> {
  const { isS3Configured, listObjectKeys, deleteObject, moveObject } = await import("@/lib/storage/s3");
  if (!isS3Configured()) return { processed: 0, held: 0, failed: 0 };
  const keys = await listObjectKeys(INBOUND_PREFIX, INBOUND_BATCH);
  let processed = 0, held = 0, failed = 0;
  for (const key of keys) {
    // SES writes a zero-byte "AMAZON_SES_SETUP_NOTIFICATION" object when the
    // rule is created; it is not mail.
    if (key.endsWith("AMAZON_SES_SETUP_NOTIFICATION")) {
      await deleteObject(key).catch(() => {});
      continue;
    }
    const name = key.slice(INBOUND_PREFIX.length);
    try {
      const msg = await readStoredMail(key, processed + 1);
      await handleMessage(msg);
      const disposition = s3Disposition(msg);
      if (disposition === "hold") {
        await moveObject(key, HELD_PREFIX + name);
        held++;
      } else if (disposition === "park") {
        await moveObject(key, FAILED_PREFIX + name);
        failed++;
      } else {
        await deleteObject(key);
      }
    } catch (e) {
      captureError("[rta-inbox] S3 inbound mail failed", e, { key });
      await moveObject(key, FAILED_PREFIX + name).catch(() => {});
      failed++;
    }
    processed++;
  }
  return { processed, held, failed };
}

/**
 * Retry held mail. Typically a firm forwards from a mailbox it has not yet
 * registered; once it is registered, the next retry routes and imports it.
 * Mail that still cannot be routed stays held until the lifecycle rule
 * removes it.
 */
export async function retryHeldS3Inbound(): Promise<{ retried: number; recovered: number }> {
  const { isS3Configured, listObjectKeys, deleteObject, moveObject } = await import("@/lib/storage/s3");
  if (!isS3Configured()) return { retried: 0, recovered: 0 };
  const keys = await listObjectKeys(HELD_PREFIX, 200);
  let retried = 0, recovered = 0;
  for (const key of keys) {
    try {
      const msg = await readStoredMail(key, retried + 1);
      await handleMessage(msg);
      retried++;
      const disposition = s3Disposition(msg);
      if (disposition === "delete") {
        await deleteObject(key);
        recovered++;
      } else if (disposition === "park") {
        await moveObject(key, FAILED_PREFIX + key.slice(HELD_PREFIX.length));
      }
    } catch (e) {
      captureError("[rta-inbox] held S3 mail retry failed", e, { key });
    }
  }
  return { retried, recovered };
}

export function startRtaInboxPollerWorker() {
  const interval = Number(process.env.RTA_INBOX_POLLER_INTERVAL_MS ?? 120_000);
  const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
  let running = false;
  let warnedIdle = false;
  let lastSweep = 0;
  let lastHeldRetry = 0;

  const tick = async () => {
    if (running) return;
    running = true;
    // Heartbeat: without this, an expired IMAP credential, an unstarted `mail`
    // worker group or a full mailbox produces ZERO signal — ingestion simply
    // stops and /api/health/workers stays green. Every exit path below records
    // an outcome so the probe can go red.
    let outcome: "ok" | "error" = "ok";
    let detail = "";
    try {
      // S3 (Amazon SES) first, and independent of the IMAP settings: once the
      // domain's MX points at SES this is the only source, and the old mailbox
      // can be removed from Aina Admin without stopping ingestion.
      try {
        const s3 = await pollS3InboundOnce();
        if (s3.processed) {
          console.log(`[rta-inbox] S3: ${s3.processed} mail(s), ${s3.held} held (unroutable), ${s3.failed} failed`);
        }
        detail = `s3 ${s3.processed}`;
        if (Date.now() - lastHeldRetry > SWEEP_INTERVAL_MS) {
          lastHeldRetry = Date.now();
          const r = await retryHeldS3Inbound();
          if (r.recovered) console.log(`[rta-inbox] S3: recovered ${r.recovered} of ${r.retried} held mail(s)`);
        }
      } catch (e) {
        outcome = "error";
        detail = `s3 inbound: ${(e as Error).message}`;
        console.error(`[rta-inbox] S3 inbound poll failed: ${(e as Error).message}`);
      }

      const rc = await loadRtaInboxConfig();
      if (!rc.configured) {
        if (!warnedIdle) {
          console.log("[rta-inbox] IMAP inbox not configured — reading S3 (Amazon SES) inbound only");
          warnedIdle = true;
        }
        return;
      }
      warnedIdle = false;
      const cfg: ImapConfig = { host: rc.host!, port: rc.port, secure: rc.secure, user: rc.user!, pass: rc.pass! };
      const { processed } = await processUnseenMailback(cfg, handleMessage);
      if (processed) console.log(`[rta-inbox] processed ${processed} message(s) (domain=${rc.domain})`);
      detail = `${detail}; imap ${processed}`;

      if (rc.deleteAfterImport && Date.now() - lastSweep > SWEEP_INTERVAL_MS) {
        lastSweep = Date.now();
        try {
          const n = await sweepImportedMail(cfg, rc.retentionDays);
          if (n) console.log(`[rta-inbox] cleanup: deleted ${n} imported mail(s) older than ${rc.retentionDays}d`);
        } catch (e) {
          captureError("[rta-inbox] cleanup sweep failed", e);
        }
      }
    } catch (e) {
      outcome = "error";
      detail = describeMailError(e, "imap");
      console.error(`[rta-inbox] poll failed: ${detail} (raw: ${(e as Error).message})`);
    } finally {
      running = false;
      // Never let a heartbeat write break the poll loop.
      await recordRun("rta-inbox-poller", outcome, detail.slice(0, 300)).catch(() => {});
    }
  };

  const handle = setInterval(tick, interval);
  handle.unref?.();
  console.log(`[rta-inbox] mailback poller started (interval=${interval}ms; config from Aina Admin)`);
  return () => clearInterval(handle);
}

