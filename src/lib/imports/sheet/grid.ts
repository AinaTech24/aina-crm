/**
 * The pure half of reading an upload: a grid of text → the headings and the rows under
 * them. Shared by the workbook reader and the CSV reader (./read), and tested without
 * any spreadsheet library.
 */

export type SheetRow = {
  /** The row's number on the sheet (1-based), so a message can say "Row 7". */
  n: number;
  cells: Record<string, string>;
};
export type SheetRows = { sheetName: string; headers: string[]; rows: SheetRow[] };

export function isWorkbook(buf: Uint8Array): boolean {
  const zip = buf[0] === 0x50 && buf[1] === 0x4b; // PK — .xlsx
  const ole = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0; // .xls
  return zip || ole;
}

/** A grid of text → the headings and the rows under them. `firstRow` is the sheet number of grid[0]. */
export function gridToRows(grid: string[][], sheetName: string, firstRow = 1): SheetRows | { error: string } {
  const has = (r: string[] | undefined) => !!r && r.some((c) => c !== "");
  let headerAt = -1;
  for (let r = 0; r < Math.min(grid.length, 10); r++) if (has(grid[r])) { headerAt = r; break; }
  if (headerAt < 0) return { error: "The sheet is empty." };

  const cols: Array<{ c: number; header: string }> = [];
  const seen = new Set<string>();
  grid[headerAt].forEach((header, c) => {
    if (header && !seen.has(header.toLowerCase())) { seen.add(header.toLowerCase()); cols.push({ c, header }); }
  });

  const rows: SheetRow[] = [];
  for (let r = headerAt + 1; r < grid.length; r++) {
    const line = grid[r];
    if (!has(line)) continue;
    const cells: Record<string, string> = {};
    for (const { c, header } of cols) cells[header] = line[c] ?? "";
    if (cols.some(({ header }) => cells[header] !== "")) rows.push({ n: firstRow + r, cells });
  }
  return { sheetName, headers: cols.map((x) => x.header), rows };
}

