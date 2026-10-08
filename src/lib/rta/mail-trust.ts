/**
 * Is an inbound RTA mail genuine enough to import, or to show a link from?
 *
 * The mailback poller used to route a mail to a firm by its forwarder / From
 * headers and import whatever attachment it carried, with no SPF / DKIM / DMARC
 * check — so anyone who knew a firm's registered forwarding mailbox could mail
 * the shared address a crafted `…WBR2.csv` and have transactions (or, through
 * the rich engine, clients and folios) written into that firm, or plant a link
 * on its settings card. This module holds the rules that replace that:
 *
 *   ROUTING   a mail belongs to a firm only through the firm's RECIPIENT ALIAS
 *             (rta-<token>@<domain>, 48 random bits, rotatable). A match on
 *             forwarder / From headers alone is QUARANTINED, never imported.
 *
 *   EVIDENCE  before an attachment is imported the mail must prove it came from
 *             the registrar, one of two ways:
 *               1. Authentication-Results written by OUR receiving server shows
 *                  dkim=pass (or dmarc=pass) for a domain on REGISTRAR_DOMAINS;
 *               2. the attachment is an encrypted archive that one of the
 *                  firm's SAVED mailback passwords actually opens — only the
 *                  registrar (and the firm) know that password, so it is proof
 *                  the registrar encrypted it for this firm.
 *             Otherwise the attachment is quarantined.
 *
 *   LINKS     only a forwarding confirmation authenticated as Google /
 *             Microsoft may place its link on the settings card, and the link
 *             must point at that provider.
 *
 * WHICH Authentication-Results we trust
 * -------------------------------------
 * The header is plain text: a sender can write their own claiming
 * "dkim=pass header.d=camsonline.com". Receiving MTAs PREPEND headers, so the
 * header our own server added is the TOPMOST one, and everything the sender
 * wrote sits below it. We therefore read ONLY the first Authentication-Results
 * header of the message, and only when its authserv-id is the one our receiving
 * server stamps:
 *   • Amazon SES inbound (the S3 reader): authserv-id `amazonses.com`.
 *   • IMAP catch-all: whatever the mailbox provider's MTA stamps — it differs per
 *     host, so it is configured in RTA_IMAP_AUTHSERV_ID (comma-separated). With
 *     it unset NO header is trusted on IMAP mail, and only the password proof
 *     can admit an attachment.
 * A second header carrying the same trusted authserv-id further down is a
 * forgery attempt (a well-behaved MTA never stamps twice) and makes the whole
 * verdict untrusted. Assumption to confirm on a real stored mail: SES always
 * prepends its own Authentication-Results; if it ever did not, the topmost
 * header could be a sender's forgery claiming amazonses.com.
 *
 * Pure functions + one async archive check; no database, no network.
 */
import { ZipReader, Uint8ArrayReader, configure } from "@zip.js/zip.js";

configure({ useWebWorkers: false });

/**
 * Registrar sending domains whose DKIM / DMARC pass counts as proof a mailback
 * is genuine. Suffix-matched (a subdomain of one counts).
 *
 * Evidence in this codebase, NOT an independent confirmation: these are the
 * registrar domains already trusted elsewhere — the download-link allowlist in
 * mailback-download.ts (camsonline.com, camsonline.in, kfintech.com,
 * kfintech.in, karvy.com) and the "never a firm's mailbox" list in
 * mailback-config.ts (camsonline.co.in, kfintech.co.in). THE OWNER MUST CONFIRM
 * the DKIM `d=` domains CAMS and KFintech actually sign mailbacks with (an ESP
 * signing as its own domain would not match, and those mails would then need
 * the password proof). A domain missing here only costs auto-import of plain
 * files; a wrong domain here would admit forged ones — keep it minimal.
 */
export const REGISTRAR_DOMAINS: readonly string[] = [
  "camsonline.com",
  "camsonline.co.in",
  "camsonline.in",
  "kfintech.com",
  "kfintech.co.in",
  "kfintech.in",
  "karvy.com",
];

/**
 * Who may send a forwarding-confirmation mail. The poller already recognises
 * Google's `forwarding-noreply@google.com` and Microsoft's confirmation mail.
 */
export const CONFIRMATION_DOMAINS: readonly string[] = ["google.com", "microsoft.com"];

/** Hosts a confirmation link may point at (https only, suffix-matched). */
export const CONFIRMATION_LINK_HOSTS: readonly string[] = ["google.com", "microsoft.com", "live.com", "outlook.com", "office.com"];

export const SES_AUTHSERV_ID = "amazonses.com";

export type MailTransport = "ses" | "imap";

/** authserv-ids we trust for a transport (lower-case). */
export function trustedAuthservIds(transport: MailTransport | undefined): string[] {
  if (transport === "ses") return [SES_AUTHSERV_ID];
  if (transport === "imap") {
    return (process.env.RTA_IMAP_AUTHSERV_ID ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

// ── Authentication-Results parsing (RFC 8601) ───────────────────────────────

export type AuthResult = {
  method: string; // dkim | dmarc | spf | arc | …
  result: string; // pass | fail | none | …
  props: Record<string, string>; // "header.d" → "camsonline.com"
};

export type ParsedAuthResults = { authservId: string; results: AuthResult[] };

/** Remove RFC 5322 comments — "(…)", nested — outside quoted strings. */
function stripComments(v: string): string {
  let out = "";
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === "\\" && i + 1 < v.length) {
      if (depth === 0) out += c + v[i + 1];
      i++;
      continue;
    }
    if (!depth && c === '"') {
      inQuote = !inQuote;
      out += c;
      continue;
    }
    if (!inQuote && c === "(") {
      depth++;
      continue;
    }
    if (!inQuote && c === ")" && depth > 0) {
      depth--;
      continue;
    }
    if (!depth) out += c;
  }
  return out;
}

/**
 * Parse one Authentication-Results header VALUE (without the "name:" prefix).
 * Tolerant: unknown items are ignored, never thrown on.
 */
export function parseAuthResults(value: string): ParsedAuthResults | null {
  const v = stripComments(String(value ?? "").replace(/\r?\n[ \t]+/g, " ")).trim();
  if (!v) return null;
  const parts = v.split(";").map((p) => p.trim());
  // authserv-id, optionally followed by a version number.
  const authservId = (parts.shift() ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!authservId) return null;
  const results: AuthResult[] = [];
  for (const p of parts) {
    const m = /^([a-z0-9_-]+)\s*=\s*([a-z]+)\b(.*)$/i.exec(p);
    if (!m) continue;
    const props: Record<string, string> = {};
    const re = /\b([a-z]+\.[a-z0-9_-]+)\s*=\s*("[^"]*"|[^\s;]+)/gi;
    let pm: RegExpExecArray | null;
    while ((pm = re.exec(m[3]))) props[pm[1].toLowerCase()] = pm[2].replace(/^"|"$/g, "").toLowerCase();
    results.push({ method: m[1].toLowerCase(), result: m[2].toLowerCase(), props });
  }
  return { authservId, results };
}

function domainMatches(domain: string | null | undefined, allow: readonly string[]): string | null {
  const d = (domain ?? "").toLowerCase().replace(/\.$/, "").replace(/^@/, "");
  if (!d) return null;
  return allow.find((a) => d === a || d.endsWith(`.${a}`)) ?? null;
}

/** The signing domain of a dkim result: header.d, else the domain of header.i. */
function dkimDomain(r: AuthResult): string | null {
  if (r.props["header.d"]) return r.props["header.d"];
  const i = r.props["header.i"];
  if (i) return i.includes("@") ? i.slice(i.lastIndexOf("@") + 1) : i;
  return null;
}

export type MailAuthVerdict = {
  /** The trusted header was found and parsed. */
  trustedHeader: boolean;
  /** Why the header was or was not trusted (for the admin log). */
  headerNote: string;
  /** Registrar domain that passed DKIM / DMARC, or null. */
  registrarDomain: string | null;
  /** Confirmation-sender domain that passed DKIM / DMARC, or null. */
  confirmationDomain: string | null;
};

/**
 * Judge a message from its Authentication-Results header values, IN HEADER
 * ORDER (topmost first) as the message carries them.
 */
export function evaluateMailAuth(
  authResultsTopFirst: string[] | undefined,
  transport: MailTransport | undefined,
  fromAddress?: string | null
): MailAuthVerdict {
  const none = (headerNote: string): MailAuthVerdict => ({
    trustedHeader: false,
    headerNote,
    registrarDomain: null,
    confirmationDomain: null,
  });
  const trusted = trustedAuthservIds(transport);
  if (!trusted.length) {
    return none(
      transport === "imap"
        ? "IMAP mail: no receiving-server authserv-id configured (RTA_IMAP_AUTHSERV_ID), so no Authentication-Results header is trusted"
        : "no trusted receiving server for this transport"
    );
  }
  const headers = authResultsTopFirst ?? [];
  if (!headers.length) return none("no Authentication-Results header");
  const parsed = headers.map(parseAuthResults);
  const top = parsed[0];
  if (!top || !trusted.includes(top.authservId)) {
    return none(`topmost Authentication-Results is not from our receiving server (${top?.authservId ?? "unparseable"})`);
  }
  if (parsed.slice(1).some((p) => p && trusted.includes(p.authservId))) {
    return none("more than one Authentication-Results header claims our receiving server — treated as forged");
  }

  const passing = top.results.filter((r) => r.result === "pass");
  const fromDomain = (fromAddress ?? "").toLowerCase().split("@")[1] ?? "";
  const passDomains: string[] = [];
  for (const r of passing) {
    if (r.method === "dkim") {
      const d = dkimDomain(r);
      if (d) passDomains.push(d);
    } else if (r.method === "dmarc") {
      // DMARC pass is about the visible From domain.
      const d = r.props["header.from"] || fromDomain;
      if (d) passDomains.push(d);
    }
  }
  let registrarDomain: string | null = null;
  for (const d of passDomains) registrarDomain ??= domainMatches(d, REGISTRAR_DOMAINS);

  // A confirmation must be authenticated AS the provider AND visibly from it.
  let confirmationDomain: string | null = null;
  const fromProvider = domainMatches(fromDomain, CONFIRMATION_DOMAINS);
  if (fromProvider) {
    for (const d of passDomains) {
      if (domainMatches(d, [fromProvider])) confirmationDomain = fromProvider;
    }
  }
  return {
    trustedHeader: true,
    headerNote: `${top.authservId}: ${passing.map((r) => r.method).join(", ") || "nothing"} passed`,
    registrarDomain,
    confirmationDomain,
  };
}

/** A confirmation link is shown only when it is https on the provider's own host. */
export function safeConfirmationUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return domainMatches(u.hostname, CONFIRMATION_LINK_HOSTS) ? u.toString() : null;
  } catch {
    return null;
  }
}

// ── Password proof ──────────────────────────────────────────────────────────

export function isZipBytes(buf: Uint8Array): boolean {
  return buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
}

export type ArchiveProof = { proven: true } | { proven: false; reason: string };

type ZipEntryLike = {
  filename: string;
  directory: boolean;
  encrypted?: boolean;
  getData?: (writer: unknown, options?: unknown) => Promise<unknown>;
};

/**
 * Does one of the firm's saved passwords open this archive — proof that the
 * registrar encrypted it for this firm?
 *
 * Every file entry must be encrypted (a mix would let an attacker pair a
 * replayed genuine entry with a plaintext one the importer picks first), and
 * the entry the importer reads (same choice as lib/rta/unzip.ts) must decrypt
 * with integrity checks on (AES HMAC / CRC). The decrypted bytes are counted
 * and discarded, never held.
 */
export async function proveArchiveForFirm(buf: Uint8Array, passwords: string[]): Promise<ArchiveProof> {
  if (!isZipBytes(buf)) return { proven: false, reason: "not an archive" };
  const usable = passwords.filter((p) => typeof p === "string" && p.length > 0);
  if (!usable.length) return { proven: false, reason: "the firm has no saved mailback password to check the archive against" };

  let entries: ZipEntryLike[];
  const reader = new ZipReader(new Uint8ArrayReader(buf));
  try {
    entries = (await reader.getEntries()) as unknown as ZipEntryLike[];
  } catch {
    await reader.close().catch(() => {});
    return { proven: false, reason: "the archive could not be read" };
  }
  try {
    const files = entries.filter((e) => !e.directory);
    if (!files.length) return { proven: false, reason: "the archive is empty" };
    if (files.some((e) => !e.encrypted)) {
      return { proven: false, reason: "the archive is not password-protected (or only partly), so it proves nothing about the sender" };
    }
    const entry = files.find((e) => /\.(csv|txt|xls[xmb]?)$/i.test(e.filename)) ?? files[0];
    if (typeof entry.getData !== "function") return { proven: false, reason: "the archive has no readable entry" };
    for (const password of usable) {
      try {
        await entry.getData(new WritableStream<Uint8Array>({ write() {} }), { password, checkSignature: true });
        return { proven: true };
      } catch {
        /* wrong password or corrupt — try the next one */
      }
    }
    return { proven: false, reason: "none of the firm's saved mailback passwords opens the archive" };
  } finally {
    await reader.close().catch(() => {});
  }
}

export type AttachmentTrust =
  | { admit: true; via: "registrar-auth" | "password"; note: string }
  | { admit: false; reason: string };

/**
 * The import decision for ONE attachment (or link-downloaded file) of a mail
 * that was routed by the firm's alias.
 */
export async function attachmentTrust(
  bytes: Uint8Array,
  auth: MailAuthVerdict,
  passwords: string[]
): Promise<AttachmentTrust> {
  if (auth.registrarDomain) {
    return { admit: true, via: "registrar-auth", note: `authenticated as ${auth.registrarDomain}` };
  }
  if (isZipBytes(bytes)) {
    const proof = await proveArchiveForFirm(bytes, passwords);
    if (proof.proven) return { admit: true, via: "password", note: "opened with the firm's saved mailback password" };
    return {
      admit: false,
      reason: `Quarantined — the mail is not authenticated as a registrar (${auth.headerNote}) and ${proof.reason}.`,
    };
  }
  return {
    admit: false,
    reason: `Quarantined — an unencrypted file from a mail that is not authenticated as a registrar (${auth.headerNote}).`,
  };
}
