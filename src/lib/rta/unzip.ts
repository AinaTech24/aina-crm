/**
 * AES-zip extraction for RTA mailback files (server-only).
 *
 * Kfintech/CAMS ship their daily feeds as WinZip-AES password-protected zips —
 * a format Node's stdlib and most zip libs can't read. `@zip.js/zip.js` is a
 * pure-JS reader with AES (and ZipCrypto) support, so we can accept the zip
 * directly and the user just supplies the password (never persisted) at upload
 * time.
 *
 * One archive, one data file. The extractor used to take the FIRST entry whose
 * name looked like data and silently drop the rest — a zip holding a feed and
 * its master imported only one of them, with no hint the other existed. Now:
 *   - 0 data entries  → rejected: "the archive contains no data file"
 *   - 1 data entry    → extracted; any other (non-data) entries are listed in
 *                       `notes` so the import can say they were ignored
 *   - 2+ data entries → the WHOLE archive is rejected, naming the entries.
 *                       Picking one would be a guess about which file the
 *                       operator meant, and importing several under one
 *                       import row (one kind, one status, one set of counts)
 *                       would misreport all of them.
 * Directories and macOS resource-fork junk (`__MACOSX/…`, `._name`) are not
 * entries at all for this purpose.
 *
 * Passwords: zip.js applies the password only to entries that are encrypted,
 * so one supplied for a plain archive is harmless, and a missing / wrong one
 * fails with zip.js's own "File contains encrypted entry" / "Invalid password"
 * (the worker's not-ours classification keys on those). The old "retry the
 * other way" fallback was a no-op (`password ? undefined : undefined`) and
 * there is no other way to retry, so it is gone.
 */

import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter, configure } from "@zip.js/zip.js";
import { DATA_FILE_EXT, zipEntryNames } from "./file-kind";

// No Web Workers in the Node server runtime — decode inline.
configure({ useWebWorkers: false });

// zip.js types Entry as a File|Directory union; only file entries expose getData.
type FileEntry = {
  filename: string;
  directory: boolean;
  encrypted?: boolean;
  getData?: (writer: unknown, options?: unknown) => Promise<Uint8Array>;
};

/**
 * The archive was opened but cannot be imported as it stands (no data file,
 * several data files, or it is really a workbook). Never a password problem —
 * the message deliberately avoids that word, because the worker classifies
 * any error mentioning "password" as "not this firm's file".
 */
export class RtaArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RtaArchiveError";
  }
}

const DATA_RE = new RegExp(`\\.(${DATA_FILE_EXT.join("|")})$`, "i");

/** macOS Finder junk that rides along in zips made on a Mac. */
function isJunk(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  return name.startsWith("__MACOSX/") || name.includes("/__MACOSX/") || base.startsWith("._") || base === ".DS_Store";
}

export type ArchiveListing = { data: string[]; other: string[] };

/** Sort an archive's file entries into data files and everything else (junk dropped). */
export function classifyArchiveEntries(entries: Array<{ filename: string; directory: boolean }>): ArchiveListing {
  const data: string[] = [];
  const other: string[] = [];
  for (const e of entries) {
    if (e.directory || e.filename.endsWith("/") || isJunk(e.filename)) continue;
    (DATA_RE.test(e.filename) ? data : other).push(e.filename);
  }
  return { data, other };
}

const listNames = (names: string[], max = 6) =>
  names.slice(0, max).join(", ") + (names.length > max ? `, … ${names.length - max} more` : "");

export async function extractRtaFileFromZip(
  buf: Uint8Array,
  password?: string
): Promise<{ filename: string; data: Uint8Array; notes: string[] }> {
  // A workbook is a zip of XML parts; "extracting" it imports one of those
  // parts as if it were the data. Callers detect workbooks first
  // (file-kind.ts); this is the backstop for any that don't.
  const names = zipEntryNames(buf);
  if (names && names.includes("[Content_Types].xml") && names.some((n) => n.startsWith("xl/"))) {
    throw new RtaArchiveError("This file is an Excel workbook (.xlsx), not a zip archive — it is read as a spreadsheet, not unpacked.");
  }

  const reader = new ZipReader(new Uint8ArrayReader(buf), password ? { password } : undefined);
  try {
    const entries = (await reader.getEntries()) as unknown as FileEntry[];
    const { data, other } = classifyArchiveEntries(entries);
    const byName = new Map(entries.map((e) => [e.filename, e]));

    if (data.length === 0) {
      throw new RtaArchiveError(
        other.length
          ? `The archive contains no data file (CSV, TXT, XLS/XLSX/XLSM/XLSB or DBF) — it holds only: ${listNames(other)}.`
          : "The archive contains no data file — it is empty."
      );
    }

    if (data.length > 1) {
      // Say "not this firm's file" before "too many files" when that is the
      // truth: verify the password on one encrypted entry first, without
      // decompressing it. A wrong / missing password throws zip.js's own error.
      const enc = data.map((n) => byName.get(n)).find((e) => e?.encrypted && typeof e.getData === "function");
      if (enc?.getData) {
        await enc.getData(new Uint8ArrayWriter(), { ...(password ? { password } : {}), checkPasswordOnly: true });
      }
      throw new RtaArchiveError(
        `The archive holds ${data.length} data files (${listNames(data)}) — this importer reads one file per upload, ` +
          `so nothing was imported. Upload them separately.`
      );
    }

    const entry = byName.get(data[0]);
    if (!entry || typeof entry.getData !== "function") {
      throw new RtaArchiveError("The archive contains no readable data file.");
    }
    // Raw bytes — the caller identifies the inner file by its content.
    const bytes = (await entry.getData(new Uint8ArrayWriter(), password ? { password } : undefined)) as Uint8Array;
    const notes = other.length ? [`Ignored ${other.length} non-data file(s) in the archive: ${listNames(other)}.`] : [];
    return { filename: entry.filename, data: bytes, notes };
  } finally {
    await reader.close();
  }
}
