/**
 * AES-zip extraction for RTA mailback files (server-only).
 *
 * Kfintech/CAMS ship their daily feeds as WinZip-AES password-protected zips —
 * a format Node's stdlib and most zip libs can't read. `@zip.js/zip.js` is a
 * pure-JS reader with AES support, so we can accept the zip directly and the
 * user just supplies the password (never persisted) at upload time.
 */

import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter, configure } from "@zip.js/zip.js";

// No Web Workers in the Node server runtime — decode inline.
configure({ useWebWorkers: false });

// zip.js types Entry as a File|Directory union; only file entries expose getData.
type FileEntry = {
  filename: string;
  directory: boolean;
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
      throw err;
    }
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
