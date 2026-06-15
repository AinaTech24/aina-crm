/**
 * Minimal, dependency-free RFC-4180 CSV parser.
 *
 * RTA mailback files are comma-delimited with optional double-quoting; names and
 * addresses can contain commas inside quotes. Stdlib has no CSV reader, so this
 * handles quoted fields, ""-escaped quotes, embedded commas/newlines, a leading
 * BOM, and CRLF/LF endings. Returns rows of raw string cells.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a leading UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the final field/row (file may not end in a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
