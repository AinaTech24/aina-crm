/**
 * IMAP mailbox helpers. `verifyImap` powers the "Test connection" button in
 * Settings → Email so an MFD can confirm their inbox credentials before saving.
 *
 * The inbound *sync* worker (pulling client replies into the unified inbox) is a
 * separate, focused build — this file intentionally stays at connection-test
 * scope for now.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { describeMailError } from "./connection-error";

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** XOAUTH2 access token (Gmail / M365 connected over OAuth). Wins over `pass`. */
  accessToken?: string;
}

/** imapflow auth block — XOAUTH2 when an access token is present, else password. */
function imapAuth(cfg: ImapConfig): { user: string; pass?: string; accessToken?: string } {
  return cfg.accessToken
    ? { user: cfg.user, accessToken: cfg.accessToken }
    : { user: cfg.user, pass: cfg.pass };
}

export interface InboundEmail {
  uid: number;
  messageId?: string;
  /** RFC 5322 threading headers — link a reply back to our outbound message. */
  inReplyTo?: string;
  references?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  text?: string;
  html?: string;
  date?: Date;
}

/** Connect, authenticate, and confirm the INBOX is readable. Throws on failure. */
export async function verifyImap(cfg: ImapConfig): Promise<void> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: imapAuth(cfg),
    logger: false,
    // Fail fast in the settings test rather than hang the request.
    socketTimeout: 15_000,
    greetingTimeout: 10_000,
  });
  try {
    await client.connect();
    try {
      await client.mailboxOpen("INBOX");
    } finally {
      await client.logout().catch(() => {});
    }
  } catch (e: any) {
    // Translate imapflow's cryptic "Command failed" into something actionable.
    throw new Error(describeMailError(e, "imap"));
  }
}

/**
 * Fetch INBOX messages with UID greater than `sinceUid` (newest unseen since the
 * last poll), parsed into a compact shape. Bounded by `limit` per call so one
 * busy inbox can't wedge the poller.
 */
export async function imapFetchSince(cfg: ImapConfig, sinceUid: number, limit = 50): Promise<InboundEmail[]> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: imapAuth(cfg),
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 10_000,
  });
  const out: InboundEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const start = (sinceUid > 0 ? sinceUid : 0) + 1;
      // Guard against fetching an empty/backwards UID range. `client.mailbox`
      // (set by getMailboxLock) carries `exists` + `uidNext`. Once the poller has
      // caught up (start >= uidNext) or the INBOX is empty, fetching "start:*"
      // makes some servers reject the FETCH with a cryptic "Command failed" —
      // the bug behind inbound email silently never arriving.
      const mb: any = client.mailbox;
      const uidNext = Number(mb?.uidNext ?? 0);
      const exists = Number(mb?.exists ?? 0);
      const hasNew = exists > 0 && (uidNext === 0 || start < uidNext);
      if (hasNew) {
        // UID range "start:*" — a UID search always returns at least the last
        // message, so we guard each one against `sinceUid` below.
        for await (const msg of client.fetch(`${start}:*`, { uid: true, source: true }, { uid: true })) {
          if (!msg.uid || msg.uid <= sinceUid) continue;
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source as Buffer);
          const fromAddr = parsed.from?.value?.[0];
          const refs = Array.isArray(parsed.references) ? parsed.references.join(" ") : parsed.references;
          out.push({
            uid: msg.uid,
            messageId: parsed.messageId ?? undefined,
            inReplyTo: parsed.inReplyTo ?? undefined,
            references: refs ?? undefined,
            from: fromAddr?.address,
            fromName: fromAddr?.name,
            subject: parsed.subject,
            text: parsed.text,
            html: typeof parsed.html === "string" ? parsed.html : undefined,
            date: parsed.date,
          });
          if (out.length >= limit) break;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}
