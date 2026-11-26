/**
 * The downloadable sample workbook of a module's import — built from its SheetSpec,
 * so the columns here are exactly the ones the importer reads.
 *
 *   Data     the headings only, ready to fill. Required ones end in " *" and are teal;
 *            choice columns (and Yes / No) have a dropdown
 *   Example  the same headings with filled rows, to copy from
 *
 * What each column takes is on the import page, not in the file. The dropdowns read
 * their values from a third sheet, "Lists", which is HIDDEN: a list of 38 task types
 * cannot be written into the dropdown itself (Excel stops at 255 characters).
 *
 * The Example rows live on their own sheet, not on Data, so they can never be
 * imported by accident. Written by ./xlsx-writer (dropdowns and colours need it).
 */
import { listColumns, sheetHeader, type SheetSpec } from "./spec";
import { STYLE, columnLetter, xlsxBytes, type Cell, type SheetDef } from "./xlsx-writer";

/** Column widths from the longest thing in each column. */
function widths(headers: string[], rows: Cell[][], min = 12, max = 44): number[] {
  return headers.map((h, i) =>
    Math.max(min, Math.min(max, Math.max(h.length + 4, ...rows.map((r) => Math.min(String(r[i] ?? "").length + 2, max))))),
  );
}

export function buildSampleWorkbook(spec: SheetSpec): Buffer {
  const headers = spec.columns.map(sheetHeader);
  const headStyles = spec.columns.map((c) => (c.required ? STYLE.headerRequired : STYLE.header));
  const examples: Cell[][] = spec.examples.map((ex) => spec.columns.map((c) => ex[c.key] ?? ""));

  // One column of the hidden Lists sheet per choice column, in column order.
  const lists = listColumns(spec);
  const longest = Math.max(1, ...lists.map((l) => l.values.length));
  const listRows: Cell[][] = [lists.map((l) => l.title)];
  for (let i = 0; i < longest; i++) listRows.push(lists.map((l) => l.values[i] ?? ""));

  // Dropdowns: a choice column points at its column of Lists; Yes / No is inline.
  const dropdowns: NonNullable<SheetDef["dropdowns"]> = [];
  let k = 0;
  spec.columns.forEach((c, i) => {
    if (c.options?.length) {
      const L = columnLetter(k);
      dropdowns.push({ column: i, formula: `Lists!$${L}$2:$${L}$${lists[k].values.length + 1}` });
      k++;
    } else if (c.kind === "bool") {
      dropdowns.push({ column: i, formula: '"Yes,No"', message: "Write Yes or No." });
    }
  });

  const dataWidths = widths(headers, examples);
  const sheets: SheetDef[] = [
    { name: "Data", rows: [headers], widths: dataWidths, styles: [headStyles], freezeHeader: true, heights: [32], dropdowns },
    {
      name: "Example", rows: [headers, ...examples], widths: dataWidths,
      styles: [headStyles, ...examples.map(() => headers.map(() => STYLE.cell))], freezeHeader: true, heights: [32], dropdowns,
    },
  ];
  if (lists.length) {
    sheets.push({ name: "Lists", rows: listRows, widths: lists.map(() => 28), hidden: true });
  }
  return xlsxBytes(sheets);
}

export function sampleFileName(spec: SheetSpec, format: "xlsx" | "csv" = "xlsx"): string {
  return `${spec.entity}-import-sample.${format}`;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The sample as a CSV file, for a module that offers one: the headings and the
 * example rows. A CSV has one sheet, so a module using it must refuse its own
 * example rows on import (see ./visitors.ts) — they could otherwise be saved.
 * Starts with a byte-order mark so Excel reads it as UTF-8.
 */
export function buildSampleCsv(spec: SheetSpec): Buffer {
  const lines = [
    spec.columns.map(sheetHeader),
    ...spec.examples.map((ex) => spec.columns.map((c) => ex[c.key] ?? "")),
  ];
  return Buffer.from("\uFEFF" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n", "utf8");
}
