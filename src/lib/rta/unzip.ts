/**
 * AES-zip extraction for RTA mailback files (server-only).
 *
 * Kfintech/CAMS ship their daily feeds as WinZip-AES password-protected zips —
 * a format Node's stdlib and most zip libs can't read. `@zip.js/zip.js` is a
 * pure-JS reader with AES support, so we can accept the zip directly and the
 * user just supplies the password (never persisted) at upload time.
 */

import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter, configure } from "@zip.js/zip.js";
import { zipCryptoOpen } from "@/lib/rta/zipcrypto";

// No Web Workers in the Node server runtime — decode inline.
configure({ useWebWorkers: false });

// zip.js types Entry as a File|Directory union; only file entries expose getData.
type FileEntry = {
  filename: string;
  directory: boolean;
  encrypted?: boolean;
  extraFieldAES?: unknown;
  compressionMethod?: number;
  signature?: number;
  uncompressedSize?: number;
  getData?: (writer: unknown, options?: unknown) => Promise<Uint8Array>;
};

/** A file inside the archive that carries data (not a folder, not a readme). */
const DATA_FILE = /\.(csv|txt|xls[xmb]?|dbf)$/i;

async function readEntry(entry: FileEntry, password?: string): Promise<Uint8Array> {
  if (typeof entry.getData !== "function") throw new Error("the archive contains no readable data file");
  try {
    return (await entry.getData(new Uint8ArrayWriter(), password ? { password } : undefined)) as Uint8Array;
  } catch (err) {
    // Resilience: if a password was supplied but this entry isn't actually
    // encrypted (or vice-versa), retry the other way before giving up.
    try {
      return (await entry.getData(new Uint8ArrayWriter(), undefined)) as Uint8Array;
    } catch {
      // ZipCrypto only: zip.js refuses the archive on a header byte writers do not
      // agree on (see zipcrypto.ts). Read the raw entry and let the CRC decide.
      const viaCrc = await tryZipCryptoByCrc(entry, password);
      if (viaCrc) return viaCrc;
      // A ZipCrypto password is checked by ONE byte, so about 1 wrong password in 256
      // passes it and then fails as garbage ("invalid block type", a bad CRC). That is a
      // wrong password, not a damaged file: say so, or the file is filed as "failed" and a
      // CI test on exactly this flakes. (AES checks two bytes plus a signature: left as is.)
      if (password && entry.encrypted && !entry.extraFieldAES && !/password/i.test((err as Error)?.message ?? "")) {
        throw new Error("Invalid password");
      }
      throw err;
    }
  }
}

async function tryZipCryptoByCrc(entry: FileEntry, password?: string): Promise<Uint8Array | null> {
  if (!password || !entry.encrypted || entry.extraFieldAES || typeof entry.getData !== "function") return null;
  if (entry.signature === undefined || entry.compressionMethod === undefined) return null;
  try {
    const raw = (await entry.getData(new Uint8ArrayWriter(), { passThrough: true })) as Uint8Array;
    return zipCryptoOpen(raw, password, entry.compressionMethod, entry.signature, entry.uncompressedSize ?? 0);
  } catch {
    return null;
  }
}

/**
 * Open the archive and return its data file, plus every OTHER data file in it.
 *
 * Only the first file used to be read; a mailback ZIP carrying two reports
 * imported one and dropped the other without a word. The caller imports the
 * first and queues the rest as imports of their own.
 */
export async function extractRtaFileFromZip(
  buf: Uint8Array,
  password?: string
): Promise<{ filename: string; data: Uint8Array; others: Array<{ filename: string; data: Uint8Array }> }> {
  const reader = new ZipReader(new Uint8ArrayReader(buf), password ? { password } : undefined);
  try {
    const entries = ((await reader.getEntries()) as unknown as FileEntry[]).filter((e) => !e.directory);
    const dataEntries = entries.filter((e) => DATA_FILE.test(e.filename));
    // Spreadsheet / text first, as before; a lone file of any extension still counts.
    const ordered = [
      ...dataEntries.filter((e) => !/\.dbf$/i.test(e.filename)),
      ...dataEntries.filter((e) => /\.dbf$/i.test(e.filename)),
    ];
    const entry = ordered[0] ?? entries[0];
    if (!entry) throw new Error("the archive contains no readable data file");
    // Return raw bytes — the caller decodes CSV as text or reads .xls as binary.
    const data = await readEntry(entry, password);
    const others: Array<{ filename: string; data: Uint8Array }> = [];
    for (const e of ordered) {
      if (e === entry) continue;
      others.push({ filename: e.filename, data: await readEntry(e, password) });
    }
    return { filename: entry.filename, data, others };
  } finally {
    await reader.close();
  }
}


/**
 * One line saying what kind of archive this is — "AES-256, 1 file" — for the
 * message on a refused import. "The password is wrong" and "this archive uses a
 * kind of encryption we cannot read" look the same from outside; this tells them
 * apart without anyone having to send the file. Never throws.
 */
/**
 * The CAMS mailback request a file belongs to, read from its NAME. CAMS names a
 * report file after the request (query reference + report code): the R9C master
 * of 20 Nov 2026 was "20112026150728_232184868R9C.csv" — request 232184868, R9.
 * The same "196525976R2" is what CAMS's Auto Mailback Queue lists as "Query Ref".
 * File names inside a ZIP are readable WITHOUT the password, so a refused archive
 * can still say which scheduled request — and therefore which password — it was.
 */
export function camsRequestFromNames(names: string[]): { queryRef: string; report: string }[] {
  const out: { queryRef: string; report: string }[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const base = n.split(/[\\/]/).pop() ?? n;
    const m = base.match(/(?:^|[_\-\s.])(\d{7,12})(R\d{1,3})(?=[A-Z]?(?:[_\-\s.]|$))/i);
    if (!m) continue;
    const key = `${m[1]}${m[2].toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ queryRef: m[1], report: m[2].toUpperCase() });
  }
  return out;
}

export async function describeZip(buf: Uint8Array): Promise<string> {
  try {
    const reader = new ZipReader(new Uint8ArrayReader(buf));
    try {
      const entries = ((await reader.getEntries()) as unknown as Array<{
        filename: string;
        directory: boolean;
        encrypted?: boolean;
        compressionMethod?: number;
        dataDescriptor?: boolean;
        extraFieldAES?: { strength?: number; vendorVersion?: number; compressionMethod?: number };
      }>).filter((e) => !e.directory);
      if (!entries.length) return "empty archive";
      const kinds = new Set(
        entries.map((e) => {
          if (!e.encrypted) return "not encrypted";
          const aes = e.extraFieldAES;
          if (aes) {
            const bits = ({ 1: 128, 2: 192, 3: 256 } as Record<number, number>)[aes.strength ?? 3] ?? 256;
            // AE-1 / AE-2 and the real compression method behind AES's "99", for whoever reads it.
            const m = aes.compressionMethod === 8 ? "deflate" : aes.compressionMethod === 0 ? "stored" : `method ${aes.compressionMethod}`;
            return `AES-${bits} AE-${aes.vendorVersion ?? "?"}, ${m}`;
          }
          return `ZipCrypto${e.dataDescriptor ? ", data descriptor" : ""}`;
        })
      );
      const requests = camsRequestFromNames(entries.map((e) => e.filename ?? ""));
      const from = requests.length
        ? `; CAMS request ${requests.map((r) => `${r.queryRef} (${r.report})`).join(", ")}`
        : "";
      return `${[...kinds].join(" + ")}, ${entries.length} file${entries.length === 1 ? "" : "s"}${from}`;
    } finally {
      await reader.close();
    }
  } catch {
    return "could not read the archive's header";
  }
}
