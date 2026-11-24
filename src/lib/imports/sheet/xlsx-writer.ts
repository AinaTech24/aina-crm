/**
 * A small .xlsx writer — enough for the import sample sheets, and no more: sheets of
 * text and numbers, a bold / coloured heading row, column widths, a frozen heading
 * row and DROPDOWN lists on cells. The spreadsheet library the CRM reads files with
 * (SheetJS Community) cannot write styles or dropdowns, which is what makes a sample
 * sheet pleasant to fill in.
 *
 * An .xlsx is a zip of XML parts. The zip here is written by hand (deflate from
 * node:zlib, CRC-32 below), so there is no dependency to keep in step. Strings are
 * written inline (no shared-strings part). Server-side only.
 */
import { deflateRawSync } from "node:zlib";

/** Style ids, indexes into the cellXfs of STYLES_XML. */
export const STYLE = {
  plain: 0,
  header: 1,           // bold on light grey
  headerRequired: 2,   // bold white on teal
  title: 3,            // bold 14
  cell: 4,             // bordered, wrapped, top aligned
  tableHead: 5,        // bold on light grey, bordered
  wrap: 6,
} as const;

export type Cell = string | number | null | undefined;

export type SheetDef = {
  name: string;
  rows: Cell[][];
  widths: number[];
  /** One style id per row, or one per cell. */
  styles?: Array<number | number[]>;
  freezeHeader?: boolean;
  /** Dropdowns: column (0-based) → the list, as an `A1` range on another sheet or a comma list. */
  dropdowns?: Array<{ column: number; formula: string; message?: string }>;
  /** Rows the dropdowns cover, from row 2. */
  dropdownRows?: number;
  /** Row heights, by row (null = automatic). */
  heights?: Array<number | null>;
  /** Not shown in Excel (still there for formulas to read) — the dropdown lists live on one. */
  hidden?: boolean;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // XML 1.0 cannot carry these control characters at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(r: number, c: number, v: Cell, style: number): string {
  const ref = `${columnLetter(c)}${r}`;
  if (v === null || v === undefined || v === "") return style ? `<c r="${ref}" s="${style}"/>` : "";
  if (typeof v === "number") return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(s: SheetDef): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  ];
  if (s.freezeHeader) {
    out.push(
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>',
    );
  }
  out.push('<sheetFormatPr defaultRowHeight="15"/>');
  out.push("<cols>" + s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + "</cols>");
  out.push("<sheetData>");
  s.rows.forEach((row, ri) => {
    const st = s.styles?.[ri] ?? 0;
    const h = s.heights?.[ri];
    const cells = row.map((v, ci) => cellXml(ri + 1, ci, v, Array.isArray(st) ? st[ci] ?? 0 : st)).join("");
    out.push(`<row r="${ri + 1}"${h ? ` ht="${h}" customHeight="1"` : ""}>${cells}</row>`);
  });
  out.push("</sheetData>");
  if (s.dropdowns?.length) {
    const last = s.dropdownRows ?? 2000;
    out.push(
      `<dataValidations count="${s.dropdowns.length}">` +
        s.dropdowns
          .map((d) => {
            const L = columnLetter(d.column);
            return (
              `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Not on the list" ` +
              `error="${esc(d.message ?? "Pick one of the values in the list (see the Lists sheet).")}" sqref="${L}2:${L}${last}">` +
              `<formula1>${esc(d.formula)}</formula1></dataValidation>`
            );
          })
          .join("") +
        "</dataValidations>",
    );
  }
  out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  out.push("</worksheet>");
  return out.join("");
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2E3"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F6F78"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB0B7B8"/></left><right style="thin"><color rgb="FFB0B7B8"/></right><top style="thin"><color rgb="FFB0B7B8"/></top><bottom style="thin"><color rgb="FFB0B7B8"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* ── the zip ─────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip of the given files (deflated). */
export function zipFiles(files: Array<{ name: string; data: Buffer }>, now = new Date()): Buffer {
  const dosTime = (now.getUTCHours() << 11) | (now.getUTCMinutes() << 5) | (now.getUTCSeconds() >> 1);
  const dosDate = ((Math.max(now.getUTCFullYear(), 1980) - 1980) << 9) | ((now.getUTCMonth() + 1) << 5) | now.getUTCDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0x0800, 6);          // names are UTF-8
    local.writeUInt16LE(8, 8);               // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);            // version made by
    central.writeUInt16LE(20, 6);            // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);       // offset of the local header
    centrals.push(central, name);

    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/* ── the workbook ────────────────────────────────────────────────────────── */

export function xlsxBytes(sheets: SheetDef[]): Buffer {
  const n = sheets.length;
  const text = (s: string) => Buffer.from(s, "utf8");
  const types =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    "</Types>";
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
    sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("") +
    "</sheets></workbook>";
  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  return zipFiles([
    { name: "[Content_Types].xml", data: text(types) },
    { name: "_rels/.rels", data: text(rels) },
    { name: "xl/workbook.xml", data: text(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: text(workbookRels) },
    { name: "xl/styles.xml", data: text(STYLES_XML) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: text(sheetXml(s)) })),
  ]);
}
