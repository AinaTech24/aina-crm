/**
 * Safe references for LOG lines (console + captureError). A production log must
 * never carry an email address, a file name a client sent (it can hold a PAN or
 * a name), a URL with tokens, an email subject/body, or a database error's
 * message (a failed query's message includes its parameters).
 *
 * Each helper keeps what ops needs to correlate (a short stable hash, a type,
 * a host, an error code) and drops the value itself. Application records that
 * staff see in the CRM (e.g. the Inbound Mail log) are not logs and keep their
 * data.
 */
import { createHash } from "node:crypto";

const h8 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);

/** "addr#1a2b3c4d" — the same address always gives the same ref; "none" when absent. */
export function addressRef(address: string | null | undefined): string {
  const a = (address ?? "").trim().toLowerCase();
  return a ? `addr#${h8(a)}` : "none";
}

/** "file#1a2b3c4d.zip" — hash of the name plus its extension (when it is a plain one). */
export function fileRef(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "file#none";
  const ext = /\.([a-z0-9]{1,5})$/i.exec(n)?.[1]?.toLowerCase();
  return `file#${h8(n)}${ext ? `.${ext}` : ""}`;
}

/** The host only ("www.camsonline.com"), never the path or query. */
export function urlRef(url: string | null | undefined): string {
  try {
    return new URL(String(url)).hostname || "url#invalid";
  } catch {
    return "url#invalid";
  }
}

/** Error class + Postgres / errno code, never the message. */
export function errorRef(e: unknown): string {
  const seen = new Set<unknown>();
  let cur: any = e;
  let code: string | undefined;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    if (typeof cur.code === "string" || typeof cur.code === "number") {
      code = String(cur.code);
      break;
    }
    cur = cur.cause;
  }
  const name = e instanceof Error ? e.name : typeof e;
  return code ? `${name} ${code}` : name;
}

/** An Error safe to hand to captureError: class + code only. */
export function safeError(e: unknown): Error {
  return new Error(errorRef(e));
}
