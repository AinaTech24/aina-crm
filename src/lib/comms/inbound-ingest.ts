/**
 * Inbound email ingest — one message at a time, never one-fails-all.
 *
 * The IMAP poller used to insert a whole fetched batch in ONE transaction. A
 * single message that could not be stored rolled the batch back, so the
 * mailbox's high-water UID never moved and the same failure repeated every
 * poll — and the error escaped the loop over mailboxes, so every mailbox after
 * it was never polled at all (2026-10-09).
 *
 * The message that did it was legitimate: the same email (same Message-ID) had
 * already been stored for ANOTHER firm, and `comms_external_unique` is on
 * (external_id, channel) across all tenants. The tenant-scoped duplicate check
 * cannot see the other firm's row (RLS), so the insert hit the unique index.
 *
 * Rules here:
 *  - Each message is stored inside its own savepoint; a failure is contained.
 *  - A cross-tenant Message-ID clash is stored with external_id NULL (the
 *    unique index is partial, WHERE external_id IS NOT NULL) and the real id
 *    in message_id. The duplicate check matches external_id OR an inbound
 *    row's message_id, so a re-fetch is still idempotent. Never a suffixed
 *    id: the inbox's Reply sends an inbound row's external_id as the
 *    In-Reply-To header, so a "<id>#tenant:<uuid>" would break the client's
 *    threading and leak the firm's id into an outgoing email.
 *  - A message that cannot be stored is HELD: a safe reference (uid + a hash of
 *    its id + the Postgres code) is returned for the caller to log and record,
 *    and the high-water mark moves past it, so it is never retried in a loop.
 *  - A transient failure (connection, timeout, deadlock, resource) aborts the
 *    batch WITHOUT moving the mark, so the whole batch is retried next poll —
 *    unless the mailbox has already failed that way repeatedly, when the message
 *    is held instead.
 *  - Text going into the row is sanitised: NUL bytes and broken surrogate pairs
 *    (which Postgres jsonb/text reject) are removed and long fields are capped.
 *
 * No subject, body or address is ever logged — only the hashed reference.
 */
import { createHash } from "node:crypto";
import type { InboundEmail } from "@/lib/comms/imap";

/** Field caps. Generous for real mail; they exist to stop a pathological message. */
export const INBOUND_LIMITS = {
  externalId: 900, // stays well inside a btree index entry
  messageId: 900,
  subject: 1_000,
  from: 320,
  fromName: 300,
  text: 200_000,
  references: 8_000,
  inReplyTo: 900,
} as const;

/** Remove what Postgres cannot store in text/jsonb, then cap the length. */
export function cleanText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  let s = typeof value === "string" ? value : String(value);
  s = s.replace(/\u0000/g, "");
  // Lone surrogates make invalid UTF-8; replace them with U+FFFD.
  s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
  if (s.length > max) {
    s = s.slice(0, max);
    // Don't end on half a surrogate pair.
    if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1);
  }
  return s;
}

export interface SanitizedInbound {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  from: string | null;
  fromName: string | null;
  subject: string | null;
  text: string | null;
  hasHtml: boolean;
  receivedAt: string | null;
  /** True when any field had to be cleaned or cut. */
  altered: boolean;
}

export function sanitizeInbound(m: InboundEmail): SanitizedInbound {
  const L = INBOUND_LIMITS;
  const pick = (v: unknown, max: number) => cleanText(v, max);
  const out: SanitizedInbound = {
    uid: Number(m.uid),
    messageId: pick(m.messageId, L.messageId)?.trim() || null,
    inReplyTo: pick(m.inReplyTo, L.inReplyTo)?.trim() || null,
    references: pick(m.references, L.references)?.trim() || null,
    from: pick(m.from, L.from),
    fromName: pick(m.fromName, L.fromName),
    subject: pick(m.subject, L.subject),
    text: pick(m.text, L.text),
    hasHtml: !!m.html,
    receivedAt: m.date instanceof Date && !Number.isNaN(m.date.getTime()) ? m.date.toISOString() : null,
    altered: false,
  };
  const before = [m.messageId, m.inReplyTo, m.references, m.from, m.fromName, m.subject, m.text];
  const after = [out.messageId, out.inReplyTo, out.references, out.from, out.fromName, out.subject, out.text];
  out.altered = before.some((b, i) => (b ?? null) !== null && String(b).trim() !== String(after[i] ?? "").trim());
  return out;
}

/** The external id a message is stored under (its Message-ID, else a per-mailbox UID key). */
export function inboundExternalId(m: SanitizedInbound, tenantId: string): string {
  return (m.messageId ?? `imap-${tenantId}-${m.uid}`).slice(0, INBOUND_LIMITS.externalId);
}

/** A reference safe to log: never the Message-ID itself. */
export function safeMessageRef(ext: string): string {
  return createHash("sha256").update(ext).digest("hex").slice(0, 12);
}

export type IngestErrorKind = "cross_tenant_duplicate" | "transient" | "bad_message";

/** Postgres error fields, from the error or the driver error it wraps. */
export function pgErrorOf(e: unknown): { code?: string; constraint?: string } {
  const seen = new Set<unknown>();
  let cur: any = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    if (typeof cur.code === "string") return { code: cur.code, constraint: cur.constraint };
    cur = cur.cause;
  }
  return {};
}

const TRANSIENT_CODES = new Set(["40001", "40P01", "55P03", "57014", "57P01", "57P02", "57P03"]);
const TRANSIENT_NODE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|Connection terminated|timeout exceeded when trying to connect/i;

export function classifyIngestError(e: unknown): IngestErrorKind {
  const { code, constraint } = pgErrorOf(e);
  if (code === "23505" && constraint === "comms_external_unique") return "cross_tenant_duplicate";
  if (code && (TRANSIENT_CODES.has(code) || code.startsWith("08") || code.startsWith("53"))) return "transient";
  if (!code && TRANSIENT_NODE.test(String((e as any)?.message ?? e))) return "transient";
  return "bad_message";
}

export interface HeldMessage {
  uid: number;
  ref: string;
  code: string | null;
  constraint: string | null;
  reason: IngestErrorKind;
}

export interface IngestDeps {
  /** True when this tenant already stored the message: external_id = ext, or an inbound row whose message_id = ext. */
  alreadyIngested(ext: string): Promise<boolean>;
  /**
   * Store one message (and its side effects). `externalId` is the id to put in
   * communications.external_id — null when another firm already holds it.
   * `ref` is the message's own id (for threading / ticket routing). Runs inside `savepoint`.
   */
  store(m: SanitizedInbound, externalId: string | null, ref: string): Promise<void>;
  /** Run fn in a savepoint: a throw rolls back only fn's work. */
  savepoint<T>(fn: () => Promise<T>): Promise<T>;
}

export interface IngestOptions {
  tenantId: string;
  /** After repeated whole-batch failures, hold a message on a transient error instead of retrying. */
  holdOnTransient?: boolean;
}

export interface IngestResult {
  ingested: number;
  skippedDuplicates: number;
  /** Stored with external_id NULL because another firm already holds the Message-ID. */
  storedWithoutExternalId: number;
  held: HeldMessage[];
  /** Highest UID that was dealt with (stored, skipped or held). */
  maxUid: number;
}

/**
 * Ingest a fetched batch. Throws ONLY for a transient failure (caller keeps the
 * high-water mark and retries next poll); every other failure is contained.
 */
export async function ingestInboundBatch(msgs: InboundEmail[], deps: IngestDeps, opts: IngestOptions): Promise<IngestResult> {
  const res: IngestResult = { ingested: 0, skippedDuplicates: 0, storedWithoutExternalId: 0, held: [], maxUid: 0 };
  const ordered = [...msgs].sort((a, b) => Number(a.uid) - Number(b.uid));

  const hold = (m: SanitizedInbound, ext: string, e: unknown, reason: IngestErrorKind) => {
    const { code, constraint } = pgErrorOf(e);
    res.held.push({ uid: m.uid, ref: safeMessageRef(ext), code: code ?? null, constraint: constraint ?? null, reason });
  };
  const failure = (m: SanitizedInbound, ext: string, e: unknown): void => {
    const kind = classifyIngestError(e);
    if (kind === "transient" && !opts.holdOnTransient) throw e;
    hold(m, ext, e, kind);
  };

  for (const raw of ordered) {
    let m: SanitizedInbound;
    try {
      m = sanitizeInbound(raw);
    } catch (e) {
      // Unreadable message object: hold it under its UID.
      const uid = Number(raw?.uid) || 0;
      res.held.push({ uid, ref: safeMessageRef(`uid:${uid}`), code: null, constraint: null, reason: "bad_message" });
      if (uid > res.maxUid) res.maxUid = uid;
      continue;
    }
    const ext = inboundExternalId(m, opts.tenantId);

    if (await deps.alreadyIngested(ext)) {
      res.skippedDuplicates++;
    } else {
      try {
        await deps.savepoint(() => deps.store(m, ext, ext));
        res.ingested++;
      } catch (e) {
        if (classifyIngestError(e) === "cross_tenant_duplicate") {
          try {
            await deps.savepoint(() => deps.store(m, null, ext));
            res.ingested++;
            res.storedWithoutExternalId++;
          } catch (e2) {
            failure(m, ext, e2);
          }
        } else {
          failure(m, ext, e);
        }
      }
    }
    if (m.uid > res.maxUid) res.maxUid = m.uid;
  }
  return res;
}
