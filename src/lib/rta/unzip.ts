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

export async function extractRtaCsvFromZip(
  buf: Uint8Array,
  password?: string
): Promise<{ filename: string; text: string }> {
  const reader = new ZipReader(new Uint8ArrayReader(buf), password ? { password } : undefined);
  try {
    const entries = (await reader.getEntries()) as unknown as FileEntry[];
    const entry =
      entries.find((e) => !e.directory && /\.(csv|txt)$/i.test(e.filename)) ??
      entries.find((e) => !e.directory);
    if (!entry || typeof entry.getData !== "function") {
      throw new Error("the archive contains no readable data file");
    }
    const data = (await entry.getData(new Uint8ArrayWriter(), password ? { password } : undefined)) as Uint8Array;
    // RTA feeds are latin-1 (ISO-8859-1), not UTF-8.
    return { filename: entry.filename, text: new TextDecoder("latin1").decode(data) };
  } finally {
    await reader.close();
  }
}
