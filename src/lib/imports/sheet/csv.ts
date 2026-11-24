/**
 * Reading a .csv upload — our own reader, not the spreadsheet library's, so that
 *   - dates stay TEXT as typed (the library turns "05/06/2026" into a US month-first
 *     date before the importer ever sees it),
 *   - accents, ₹ and Hindi names survive (UTF-8, with or without the BOM Excel adds,
 *     else Windows-1252 — what an older Excel on Windows saves),
 *   - a file saved with ; or tabs (some regional settings) reads like one with commas.
 * Pure.
 */

/** Text from the bytes of a file: UTF-8 (BOM dropped), else Windows-1252. */
export function decodeText(buf: Uint8Array): string {
  let bytes = buf;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export type Delimiter = "," | ";" | "\t";

/** The separator, from the first record: the one of , ; tab it holds most of outside quotes (comma when none). */
export function detectDelimiter(text: string): Delimiter {
  const count: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) { if (count[","] + count[";"] + count["\t"] > 0) break; }
    else if (!quoted && ch in count) count[ch as Delimiter]++;
  }
  return count[";"] > count[","] && count[";"] >= count["\t"] ? ";" : count["\t"] > count[","] ? "\t" : ",";
}

/** Excel writes a long number as ="9876543210" to keep it text; the text is what was meant. */
const unwrapFormula = (s: string) => {
  const m = /^="(.*)"$/.exec(s);
  return m ? m[1] : s;
};

/** RFC 4180: quoted fields, "" for a quote, new lines inside quotes, CRLF / LF / CR between records. */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    row.push(unwrapFormula((wasQuoted ? field : field.trim()).replace(/ /g, " ")).trim());
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      wasQuoted = true;
      field = "";
    } else if (ch === delimiter) endField();
    else if (ch === "\r") { if (text[i + 1] === "\n") i++; endRow(); }
    else if (ch === "\n") endRow();
    else field += ch;
  }
  if (field !== "" || row.length > 0 || wasQuoted) endRow();
  return rows;
}
