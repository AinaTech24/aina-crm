/**
 * The raw-mail archive behind Aina Admin → Inbound Mail's "Open mail" (the
 * whole message, as in Gmail) and attachment downloads.
 *
 * Every mail the RTA poller handles is kept, as received (.eml), in the
 * uploads bucket under rta-inbound-archive/ for RTA_INBOUND_ARCHIVE_DAYS (30)
 * days; `rta_inbound_messages.raw_key` points at it. Before this, a routed
 * mail was deleted from S3 / the mailbox once handled, so a mail that did NOT
 * import — a NIGO list, a report with a code we do not know — could never be
 * read or its attachment recovered.
 *
 * - Archiving is best-effort: a failed write never stops an import.
 * - The hourly sweep deletes archived mail past the window and clears the key.
 * - Rendering happens here, server-side: the HTML body is wrapped in a page
 *   with a Content-Security-Policy that blocks scripts and every remote load
 *   (inline `cid:` images are swapped for data: URIs), and the screen shows it
 *   in a sandboxed iframe. Mail carries client data — platform admins only,
 *   and every open / download is audited by the routes.
 */

import { createHash } from "node:crypto";
import { simpleParser, type AddressObject, type Attachment } from "mailparser";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { deleteObject, getObjectBytes, putObject } from "@/lib/storage/s3";

export const ARCHIVE_PREFIX = "rta-inbound-archive/";
/** Larger mails are not archived (registrar mails are a few hundred KB). */
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;

export function archiveDays(): number {
  const n = Number(process.env.RTA_INBOUND_ARCHIVE_DAYS ?? 30);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
}

/** Store the raw mail; the key is content-addressed, so a re-run writes the same object. */
export async function archiveRawMail(raw: Buffer | undefined, receivedAt?: Date): Promise<{ key: string; size: number } | null> {
  if (!raw || !raw.length || raw.length > MAX_ARCHIVE_BYTES) return null;
  const month = (receivedAt && !Number.isNaN(receivedAt.getTime()) ? receivedAt : new Date()).toISOString().slice(0, 7);
  const key = `${ARCHIVE_PREFIX}${month}/${createHash("sha256").update(raw).digest("hex")}.eml`;
  await putObject(key, raw, "message/rfc822");
  return { key, size: raw.length };
}

/** Delete archived mail past the window. Returns how many were removed. */
export async function sweepArchivedMail(days = archiveDays()): Promise<number> {
  const rows = await withSystem(async (tx) =>
    (await tx.execute(sql`
      SELECT id::text AS id, raw_key FROM rta_inbound_messages
       WHERE raw_key IS NOT NULL AND created_at < now() - (${String(days)} || ' days')::interval
       ORDER BY created_at LIMIT 500`)).rows as Array<{ id: string; raw_key: string }>
  );
  if (!rows.length) return 0;
  const done: string[] = [];
  for (const r of rows) {
    try {
      // The same mail delivered twice shares one object; keep it while a newer row still points at it.
      const still = await withSystem(async (tx) =>
        (await tx.execute(sql`
          SELECT 1 FROM rta_inbound_messages
           WHERE raw_key = ${r.raw_key} AND id <> ${r.id}::uuid
             AND created_at >= now() - (${String(days)} || ' days')::interval LIMIT 1`)).rows.length > 0
      );
      if (!still) await deleteObject(r.raw_key);
      done.push(r.id);
    } catch {
      // Left for the next sweep.
    }
  }
  if (done.length) {
    await withSystem((tx) =>
      tx.execute(sql`UPDATE rta_inbound_messages SET raw_key = NULL
                      WHERE id IN (${sql.join(done.map((i) => sql`${i}::uuid`), sql`, `)})`)
    );
  }
  return done.length;
}

export type MailAddress = { name: string | null; address: string | null };
export type MailAttachmentInfo = { index: number; filename: string; contentType: string; size: number; inline: boolean };
export type MailView = {
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  replyTo: MailAddress[];
  date: string | null;
  subject: string | null;
  /** A complete, locked-down HTML page for a sandboxed iframe; null for a text-only mail. */
  htmlDoc: string | null;
  text: string | null;
  /** Remote images and other remote content were left out. */
  blockedRemote: boolean;
  attachments: MailAttachmentInfo[];
};

const addrs = (a: AddressObject | AddressObject[] | undefined): MailAddress[] =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((o) => o.value.map((v) => ({ name: v.name || null, address: v.address || null })));

const MAX_INLINE_IMAGE = 3 * 1024 * 1024;
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";

function attachmentName(a: Attachment, i: number): string {
  if (a.filename) return a.filename;
  const ext = (a.contentType.split("/")[1] ?? "bin").split(/[;+]/)[0];
  return `attachment-${i + 1}.${ext}`;
}

/** Everything the viewer shows. */
export async function mailView(raw: Buffer): Promise<MailView> {
  const p = await simpleParser(raw, { skipTextToHtml: true });
  const atts = p.attachments ?? [];
  let html = typeof p.html === "string" && p.html.trim() ? p.html : null;
  let blockedRemote = false;
  if (html) {
    // Inline images referenced as cid: become data: URIs; anything remote stays blocked by the CSP.
    for (const a of atts) {
      if (!a.cid || a.size > MAX_INLINE_IMAGE || !a.contentType.startsWith("image/")) continue;
      const uri = `data:${a.contentType};base64,${a.content.toString("base64")}`;
      html = html.split(`cid:${a.cid}`).join(uri);
    }
    blockedRemote = /\b(?:src|background)\s*=\s*["']?https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
  }
  const htmlDoc = html
    ? `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
      `<base target="_blank"><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;margin:16px;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`
    : null;
  return {
    from: addrs(p.from),
    to: addrs(p.to),
    cc: addrs(p.cc),
    replyTo: addrs(p.replyTo),
    date: p.date ? p.date.toISOString() : null,
    subject: p.subject ?? null,
    htmlDoc,
    text: p.text ?? null,
    blockedRemote,
    attachments: atts.map((a, i) => ({
      index: i,
      filename: attachmentName(a, i),
      contentType: a.contentType,
      size: a.size,
      inline: !!a.cid && a.contentDisposition === "inline",
    })),
  };
}

/** One attachment's bytes, by its position in the mail. */
export async function mailAttachment(raw: Buffer, index: number): Promise<{ filename: string; contentType: string; content: Buffer } | null> {
  const p = await simpleParser(raw, { skipTextToHtml: true, skipHtmlToText: true });
  const a = (p.attachments ?? [])[index];
  return a ? { filename: attachmentName(a, index), contentType: a.contentType || "application/octet-stream", content: a.content } : null;
}

export const readArchivedMail = (key: string) => getObjectBytes(key);
