/**
 * What an uploaded RTA file actually IS — decided by its CONTENT, never by the
 * first two bytes alone and never by the file name alone.
 *
 * Why this exists: every import path used to call anything starting with "PK"
 * a zip archive and unpack it. An .xlsx (and .xlsm / .xlsb / .ods) IS a zip — a
 * zip of XML parts — so a plain workbook upload was "extracted", and the first
 * internal part (e.g. `xl/_rels/workbook.xml.rels`) was imported as if it were
 * the registrar's data. Every .xlsx upload failed or imported garbage.
 *
 * The rules, in order:
 *   - ZIP magic + an OOXML package inside (`[Content_Types].xml` and `xl/…`)
 *     → a workbook (xlsx, or xlsb when the workbook part is binary)
 *   - ZIP magic + an OpenDocument spreadsheet (`mimetype` + `content.xml`)
 *     → a workbook (ods)
 *   - ZIP magic + an OOXML package that is NOT a workbook (docx/pptx)
 *     → unsupported, said so
 *   - any other ZIP → an archive to extract
 *   - CFB / OLE2 magic (D0 CF 11 E0 A1 B1 1A E1) → a legacy .xls workbook. A
 *     password-protected .xlsx is ALSO a CFB container (EncryptionInfo +
 *     EncryptedPackage streams); that is only recognised when SheetJS fails on
 *     it — see `passwordProtectedWorkbookError`.
 *   - a dBASE / FoxPro header, or a .dbf name → a DBF table
 *   - PDF / gzip / rar / 7z → unsupported, said so (they were read as text and
 *     failed as "unrecognised header" with no hint why)
 *   - markup ("<…") under a spreadsheet name → an HTML / XML-2003 "xls", which
 *     only SheetJS can read
 *   - everything else → delimited text (CSV / TXT / pipe)
 *
 * Pure and synchronous: the zip check reads the archive's central directory
 * (names only, never contents), which needs no password even for an encrypted
 * archive.
 */

import * as XLSX from "xlsx";

export type RtaWorkbookFormat = "xlsx" | "xlsb" | "ods" | "xls" | "dbf" | "markup";

export type RtaContainer =
  | { type: "zip-archive" }
  | { type: "workbook"; format: RtaWorkbookFormat }
  | { type: "unsupported"; reason: string }
  | { type: "text" };

/** Extensions a registrar data file may carry inside an archive. */
export const DATA_FILE_EXT = ["csv", "txt", "xls", "xlsx", "xlsm", "xlsb", "dbf"] as const;

const SPREADSHEET_NAME = /\.(xls|xlsx|xlsm|xlsb|xlt|xltx|xltm|ods|xml|htm|html)$/i;

export const PASSWORD_PROTECTED_WORKBOOK =
  "This is a password-protected Excel workbook, which the importer cannot open. " +
  "Save it again without a password, or upload the original zip the registrar sent.";

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function isCfb(buf: Uint8Array): boolean {
  return startsWith(buf, CFB_MAGIC);
}

export function isZipMagic(buf: Uint8Array): boolean {
  // PK\x03\x04 local header, PK\x05\x06 empty archive, PK\x07\x08 spanned marker.
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b &&
    ((buf[2] === 0x03 && buf[3] === 0x04) || (buf[2] === 0x05 && buf[3] === 0x06) || (buf[2] === 0x07 && buf[3] === 0x08));
}

/**
 * Entry names from a zip's central directory, or null when it cannot be read
 * (truncated / corrupt / prefixed archive — the zip reader then reports the
 * real error). Names only: contents are never touched, so no password needed.
 */
export function zipEntryNames(buf: Uint8Array): string[] | null {
  const len = buf.length;
  if (len < 22) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const floor = Math.max(0, len - 22 - 0xffff);
  let eocd = -1;
  for (let i = len - 22; i >= floor; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    // ZIP64: the real figures live in the ZIP64 end-of-central-directory record.
    const loc = eocd - 20;
    if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) return null;
    const rec = Number(dv.getBigUint64(loc + 8, true));
    if (rec + 56 > len || dv.getUint32(rec, true) !== 0x06064b50) return null;
    count = Number(dv.getBigUint64(rec + 32, true));
    cdOffset = Number(dv.getBigUint64(rec + 48, true));
  }
  const names: string[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > len || dv.getUint32(p, true) !== 0x02014b50) return null;
    const flags = dv.getUint16(p + 8, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const raw = buf.subarray(p + 46, p + 46 + nameLen);
    names.push(new TextDecoder(flags & 0x0800 ? "utf-8" : "latin1").decode(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Workbook format of a zip package, or null when it is a plain archive. */
function zipPackageKind(names: string[]): RtaWorkbookFormat | "office-non-workbook" | null {
  const set = new Set(names);
  if (set.has("[Content_Types].xml")) {
    if (set.has("xl/workbook.bin")) return "xlsb";
    if (names.some((n) => n.startsWith("xl/"))) return "xlsx";
    return "office-non-workbook";
  }
  if (set.has("mimetype") && set.has("content.xml")) return "ods";
  return null;
}

/**
 * dBASE III/IV / FoxPro / Visual FoxPro table header: a known version byte, a
 * plausible last-update date, a header length that holds 32-byte field
 * descriptors ended by 0x0D, and records that fit in the file.
 */
const DBF_VERSIONS = new Set([0x03, 0x04, 0x05, 0x30, 0x31, 0x32, 0x43, 0x63, 0x83, 0x8b, 0xcb, 0xf5, 0xe5, 0xfb]);
export function looksLikeDbf(b: Uint8Array): boolean {
  if (b.length < 65 || !DBF_VERSIONS.has(b[0])) return false;
  const mm = b[2];
  const dd = b[3];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const records = dv.getUint32(4, true);
  const headerLen = dv.getUint16(8, true);
  const recordLen = dv.getUint16(10, true);
  if (headerLen < 65 || headerLen > b.length || recordLen < 2) return false;
  let p = 32;
  while (p < headerLen && b[p] !== 0x0d) p += 32;
  if (p === 32 || p >= headerLen) return false;
  return headerLen + records * recordLen <= b.length + 1;
}

/** First non-blank character of a text file, ignoring a BOM (UTF-8 or UTF-16). */
function firstTextChar(b: Uint8Array): string {
  let i = 0;
  if (startsWith(b, [0xef, 0xbb, 0xbf])) i = 3;
  else if (startsWith(b, [0xff, 0xfe]) || startsWith(b, [0xfe, 0xff])) i = 2;
  const step = i === 2 ? 2 : 1;
  const lo = startsWith(b, [0xff, 0xfe]);
  for (let n = 0; i < b.length && n < 4096; i += step, n++) {
    const code = step === 2 ? (lo ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]) : b[i];
    const ch = String.fromCharCode(code);
    if (!/\s/.test(ch)) return ch;
  }
  return "";
}

/** Identify an uploaded (or extracted) file by its bytes; the name only breaks ties. */
export function detectRtaContainer(buf: Uint8Array, filename = ""): RtaContainer {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();

  if (isZipMagic(buf)) {
    const names = zipEntryNames(buf);
    if (names) {
      const pkg = zipPackageKind(names);
      if (pkg === "office-non-workbook") {
        return { type: "unsupported", reason: "This is an Office document (Word / PowerPoint), not a registrar data file or an Excel workbook." };
      }
      if (pkg) return { type: "workbook", format: pkg };
    }
    return { type: "zip-archive" };
  }
  if (isCfb(buf)) return { type: "workbook", format: "xls" };
  if (looksLikeDbf(buf) || (ext === "dbf" && buf.length > 0 && !isText(buf))) return { type: "workbook", format: "dbf" };

  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { type: "unsupported", reason: "This is a PDF, not a data file. Request the report from the registrar as CSV, Excel or DBF." };
  }
  if (startsWith(buf, [0x1f, 0x8b])) {
    return { type: "unsupported", reason: "This is a gzip / tar archive, which the importer does not read. Send the registrar's .zip, or the CSV / Excel file itself." };
  }
  if (startsWith(buf, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) || startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return { type: "unsupported", reason: "This is a RAR / 7-Zip archive, which the importer does not read. Send the registrar's .zip, or the CSV / Excel file itself." };
  }

  if (SPREADSHEET_NAME.test(filename) && firstTextChar(buf) === "<") return { type: "workbook", format: "markup" };
  return { type: "text" };
}

/** Rough "is this text" probe for the DBF-by-name fallback: no NULs up front. */
function isText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 512);
  for (let i = 0; i < n; i++) if (b[i] === 0) return false;
  return true;
}

/**
 * Is this CFB container an ENCRYPTED workbook? A password-protected .xlsx is a
 * CFB file holding `EncryptionInfo` + `EncryptedPackage`; a password-protected
 * BIFF .xls holds a FILEPASS record that SheetJS reports itself. Only called
 * after SheetJS has already failed, so the extra CFB parse costs nothing on the
 * happy path.
 */
export function isEncryptedWorkbook(buf: Uint8Array, sheetJsError?: unknown): boolean {
  const msg = sheetJsError instanceof Error ? sheetJsError.message : String(sheetJsError ?? "");
  if (/password|encrypt/i.test(msg)) return true;
  if (!isCfb(buf)) return false;
  try {
    const cfb = XLSX.CFB.read(buf, { type: "buffer" });
    return !!(XLSX.CFB.find(cfb, "EncryptionInfo") || XLSX.CFB.find(cfb, "EncryptedPackage") || XLSX.CFB.find(cfb, "/encryption"));
  } catch {
    return false;
  }
}

/** Thrown for a file the importer recognised and will not read, with the reason as the message. */
export class RtaUnreadableFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RtaUnreadableFileError";
  }
}

// ── Text decoding ───────────────────────────────────────────────────────────

/**
 * Bytes of a delimited text file → string.
 *
 * The importers used to decode every CSV as latin-1. A UTF-8 BOM then became
 * "ï»¿" glued to the first header (so the first column never matched), UTF-8
 * names became mojibake, and a UTF-16 export decoded to NUL-riddled garbage
 * that imported nothing.
 *
 *   - UTF-8 BOM / UTF-16 LE BOM / UTF-16 BE BOM → that encoding, BOM stripped
 *   - no BOM but every other byte NUL (a UTF-16 export written without one)
 *     → UTF-16 in the byte order the NULs show
 *   - otherwise UTF-8 if the bytes are valid UTF-8 (fatal decode), else
 *     latin-1 (ISO-8859-1, every byte one character) — what the old path used
 *     for everything
 */
export function decodeTextBytes(buf: Uint8Array): string {
  if (startsWith(buf, [0xef, 0xbb, 0xbf])) return new TextDecoder("utf-8").decode(buf.subarray(3));
  if (startsWith(buf, [0xff, 0xfe])) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (startsWith(buf, [0xfe, 0xff])) return new TextDecoder("utf-16be").decode(buf.subarray(2));

  const bomless = bomlessUtf16(buf);
  if (bomless) return new TextDecoder(bomless).decode(buf);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("latin1").decode(buf);
  }
}

/** UTF-16 without a BOM: in the first 1 KB, nearly every odd (LE) or even (BE) byte is NUL and the others are not. */
function bomlessUtf16(buf: Uint8Array): "utf-16le" | "utf-16be" | null {
  const n = Math.min(buf.length, 1024) & ~1;
  if (n < 64) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < n; i += 2) {
    if (buf[i] === 0) evenNul++;
    if (buf[i + 1] === 0) oddNul++;
  }
  const pairs = n / 2;
  if (oddNul >= pairs * 0.9 && evenNul <= pairs * 0.1) return "utf-16le";
  if (evenNul >= pairs * 0.9 && oddNul <= pairs * 0.1) return "utf-16be";
  return null;
}
