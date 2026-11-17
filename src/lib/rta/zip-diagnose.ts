/**
 * What is wrong with a ZIP the CRM will not open — answered from the bytes alone.
 *
 * For a WinZip-AES archive the password check is exact: the first bytes of each entry
 * are a salt and two "password verification" bytes taken from PBKDF2-HMAC-SHA1 of the
 * password. So for any candidate we can say, without unzipping anything, whether it is
 * the archive's password — and in which encoding / form it matches. That separates the
 * cases that look identical from outside:
 *   · a wrong password            → no form of any candidate matches
 *   · a right password, odd form  → a form matches (upper case, Latin-1 bytes, …)
 *   · a fault in the CRM          → a form matches although the importer refused it
 *
 * Nothing here prints a password: candidates are shown by length and a short hash only.
 */
import { createHash, pbkdf2Sync } from "node:crypto";
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter, configure } from "@zip.js/zip.js";

configure({ useWebWorkers: false });

type ZEntry = {
  filename: string;
  directory: boolean;
  encrypted?: boolean;
  compressionMethod?: number;
  compressedSize?: number;
  uncompressedSize?: number;
  dataDescriptor?: boolean;
  extraFieldAES?: { strength?: number; vendorVersion?: number; compressionMethod?: number };
  getData?: (writer: unknown, options?: unknown) => Promise<Uint8Array>;
};

export type EncodingForm = { label: string; bytes: Buffer };

/** The byte forms one text password can take, in the order a writer is likely to have used. */
export function passwordForms(pw: string): EncodingForm[] {
  const out: EncodingForm[] = [];
  const add = (label: string, bytes: Buffer) => {
    if (!out.some((o) => o.bytes.equals(bytes))) out.push({ label, bytes });
  };
  const bases: Array<[string, string]> = [["as typed", pw]];
  if (pw.trim() !== pw) bases.push(["trimmed", pw.trim()]);
  if (pw.toUpperCase() !== pw) bases.push(["UPPER case", pw.toUpperCase()]);
  if (pw.toLowerCase() !== pw) bases.push(["lower case", pw.toLowerCase()]);
  if (pw.trim() === pw) {
    bases.push(["+ trailing space", pw + " "]);
    bases.push(["+ leading space", " " + pw]);
  }
  for (const [name, text] of bases) {
    add(`${name}, UTF-8`, Buffer.from(text, "utf8"));
    // eslint-disable-next-line no-control-regex -- detecting any non-ASCII
    if (/[^\x00-\x7f]/.test(text)) {
      add(`${name}, Latin-1 bytes`, Buffer.from(text, "latin1"));
      add(`${name}, UTF-16LE`, Buffer.from(text, "utf16le"));
    }
  }
  return out;
}

const KEY_BYTES: Record<number, number> = { 1: 16, 2: 24, 3: 32 };

/** Does this password (as these bytes) pass the archive's 2-byte AES check? */
export function aesVerificationMatches(password: Buffer, strength: number, salt: Uint8Array, verifier: Uint8Array): boolean {
  const keyLen = KEY_BYTES[strength] ?? 32;
  const derived = pbkdf2Sync(password, Buffer.from(salt), 1000, keyLen * 2 + 2, "sha1");
  return derived[keyLen * 2] === verifier[0] && derived[keyLen * 2 + 1] === verifier[1];
}

const fingerprint = (s: string) => `len ${s.length}, sha ${createHash("sha256").update(s).digest("hex").slice(0, 6)}`;

export type ZipReport = {
  bytes: number;
  sha256: string;
  startsWithPK: boolean;
  entries: Array<{
    name: string;
    kind: string;
    method: string;
    compressedSize: number | null;
    uncompressedSize: number | null;
    /** For AES: which candidates (by fingerprint) pass the exact password check, and in which form. */
    matches: Array<{ candidate: string; form: string }>;
    candidatesTried: number;
  }>;
  verdict: string;
};

export async function diagnoseZip(buf: Uint8Array, candidates: string[]): Promise<ZipReport> {
  const report: ZipReport = {
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    startsWithPK: buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b,
    entries: [],
    verdict: "",
  };
  if (!report.startsWithPK) {
    report.verdict = "Not a ZIP: the file does not start with PK. The stored bytes are something else (a web page, an error text, another format).";
    return report;
  }
  let reader: ZipReader<Uint8Array> | null = null;
  try {
    reader = new ZipReader(new Uint8ArrayReader(buf));
    const entries = ((await reader.getEntries()) as unknown as ZEntry[]).filter((e) => !e.directory);
    let anyMatch = false;
    let anyAes = false;
    for (const e of entries) {
      const aes = e.extraFieldAES;
      const kind = !e.encrypted ? "not encrypted" : aes ? `AES-${({ 1: 128, 2: 192, 3: 256 } as Record<number, number>)[aes.strength ?? 3] ?? 256} AE-${aes.vendorVersion ?? "?"}` : `ZipCrypto${e.dataDescriptor ? " (data descriptor)" : ""}`;
      const method = aes ? (aes.compressionMethod === 8 ? "deflate" : aes.compressionMethod === 0 ? "stored" : `method ${aes.compressionMethod}`) : e.compressionMethod === 8 ? "deflate" : e.compressionMethod === 0 ? "stored" : `method ${e.compressionMethod}`;
      const row: ZipReport["entries"][number] = {
        name: e.filename,
        kind,
        method,
        compressedSize: e.compressedSize ?? null,
        uncompressedSize: e.uncompressedSize ?? null,
        matches: [],
        candidatesTried: candidates.length,
      };
      if (e.encrypted && aes && typeof e.getData === "function") {
        anyAes = true;
        // The entry's raw bytes begin with salt + 2 verification bytes.
        const raw = (await e.getData(new Uint8ArrayWriter(), { passThrough: true })) as Uint8Array;
        const strength = aes.strength ?? 3;
        const saltLen = ({ 1: 8, 2: 12, 3: 16 } as Record<number, number>)[strength] ?? 16;
        const salt = raw.subarray(0, saltLen);
        const verifier = raw.subarray(saltLen, saltLen + 2);
        for (const c of candidates) {
          for (const f of passwordForms(c)) {
            if (aesVerificationMatches(f.bytes, strength, salt, verifier)) {
              row.matches.push({ candidate: fingerprint(c), form: f.label });
              anyMatch = true;
            }
          }
        }
      }
      report.entries.push(row);
    }
    if (!entries.length) report.verdict = "A ZIP with no files in it.";
    else if (!report.entries.some((x) => x.kind !== "not encrypted")) report.verdict = "Not encrypted: this archive needs no password at all.";
    else if (anyAes && anyMatch) report.verdict = "A candidate passes the archive's exact password check (see the form). If the importer still refuses this file, the fault is in the CRM — send this report.";
    else if (anyAes) report.verdict = "No candidate, in any usual form, passes the archive's exact password check: this archive was locked with another password than the ones given.";
    else report.verdict = "ZipCrypto archive: its password check is only a 1-byte hint, so it cannot be settled from the header alone — try the importer.";
  } catch (e) {
    report.verdict = `Could not read the ZIP structure: ${(e as Error).message}`;
  } finally {
    await reader?.close().catch(() => {});
  }
  return report;
}
