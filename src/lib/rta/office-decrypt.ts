/**
 * Password-protected Excel from a registrar.
 *
 * A CAMS "WebTrxns…xls" can be an OLE container holding an ENCRYPTED workbook, not a
 * workbook. SheetJS refuses it ("File is password-protected"), and `decodeRtaToText`
 * used to swallow that error and hand the raw bytes on as text — so the page said
 * "the file has 49 data lines but none could be read — its layout is not one this importer
 * recognises", with a line of binary garbage, and nobody could tell it was a password.
 *
 * Here the encryption is recognised and opened with the same passwords the firm saved for
 * the ZIPs (each tried as held and in the other forms it may really be in), so such a
 * file imports on its own. Standard / Agile OOXML encryption and the old xls RC4 are
 * read by officecrypto-tool.
 */
import * as officeCrypto from "officecrypto-tool";
import { passwordVariants } from "@/lib/rta/password-variants";

/** True when the bytes are an Office file that needs a password to open. */
export function isEncryptedOffice(buf: Uint8Array | Buffer): boolean {
  // OLE2 header, which is what both an encrypted xlsx and a BIFF8 xls start with.
  if (buf.length < 8 || buf[0] !== 0xd0 || buf[1] !== 0xcf || buf[2] !== 0x11 || buf[3] !== 0xe0) return false;
  try {
    return officeCrypto.isEncrypted(Buffer.from(buf));
  } catch {
    return false;
  }
}

export type OfficeOpened =
  | { ok: true; data: Buffer; usedPassword: string }
  | { ok: false; triedCount: number };

/** Open an encrypted Office file with the first password that fits. */
export async function openEncryptedOffice(buf: Uint8Array | Buffer, passwords: string[]): Promise<OfficeOpened> {
  const input = Buffer.from(buf);
  for (const base of passwords) {
    for (const exact of passwordVariants(base)) {
      try {
        const out = await officeCrypto.decrypt(input, { password: exact });
        return { ok: true, data: Buffer.from(out), usedPassword: exact };
      } catch {
        /* wrong password (or this form of it) — try the next */
      }
    }
  }
  return { ok: false, triedCount: passwords.length };
}

/** The message a person reads on the import row when no saved password opens it. */
export function encryptedOfficeMessage(triedCount: number): string {
  return (
    `Not opened — this Excel file is password-protected and ` +
    (triedCount > 0
      ? `${triedCount === 1 ? "the one saved password" : `none of the ${triedCount} saved passwords`} did not open it. `
      : `no password is saved for it. `) +
    `Save the password it was requested with under Settings → Integrations → RTA Mailback ` +
    `(CAMS or KFintech) and it imports by itself.`
  );
}
