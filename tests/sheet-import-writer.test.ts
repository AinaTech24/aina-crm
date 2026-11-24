/**
 * The sample workbook the import pages download (lib/imports/sheet/write.ts + xlsx-writer.ts). The zip is written by
 * hand, so this reads it back the way Excel would: the central directory, every part inflated and its CRC checked,
 * then the XML for the headings, the required-column colour and the dropdowns.
 */
import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { buildSampleWorkbook } from "@/lib/imports/sheet/write";
import { columnLetter, crc32 } from "@/lib/imports/sheet/xlsx-writer";
import { sheetHeader } from "@/lib/imports/sheet/spec";
import { tasksSpec } from "@/lib/imports/sheet/specs/tasks";
import { meetingsSpec } from "@/lib/imports/sheet/specs/meetings";
import { serviceRequestsSpec } from "@/lib/imports/sheet/specs/service-requests";

/** Every file in a zip, read from its central directory. */
function unzip(buf: Buffer): Record<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const csize = buf.readUInt32LE(at + 20);
    const usize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const packed = buf.subarray(dataAt, dataAt + csize);
    expect(method).toBe(8);
    const raw = inflateRawSync(packed);
    expect(raw.length).toBe(usize);
    expect(crc32(raw)).toBe(crc);
    out[name] = raw.toString("utf8");
    at += 46 + nameLen;
  }
  return out;
}

const specs = [tasksSpec, meetingsSpec, serviceRequestsSpec];

describe("crc32 / columnLetter", () => {
  it("matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
  it("names columns like a spreadsheet", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });
});

describe.each(specs.map((s) => [s.label, s] as const))("%s sample workbook", (_n, spec) => {
  const files = unzip(buildSampleWorkbook(spec));

  it("is a complete workbook: content types, relationships, styles and the sheets", () => {
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml",
      "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml",
    ]);
  });

  it("shows Data and Example only — there is no Instructions sheet, and the dropdown Lists are hidden", () => {
    const wb = files["xl/workbook.xml"];
    expect(wb).toContain('<sheet name="Data" sheetId="1" r:id="rId1"/>');
    expect(wb).toContain('<sheet name="Example" sheetId="2" r:id="rId2"/>');
    expect(wb).toContain('<sheet name="Lists" sheetId="3" state="hidden" r:id="rId3"/>');
    expect(wb).not.toContain("Instructions");
  });

  it("the Data sheet has every column's heading, in order, and no data rows", () => {
    const data = files["xl/worksheets/sheet1.xml"];
    const texts = [...data.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"'));
    expect(texts).toEqual(spec.columns.map(sheetHeader));
    expect(data.match(/<row /g)?.length).toBe(1);
  });

  it("required columns carry the required heading style, the rest the plain one", () => {
    const data = files["xl/worksheets/sheet1.xml"];
    spec.columns.forEach((c, i) => {
      expect(data).toContain(`<c r="${columnLetter(i)}1" s="${c.required ? 2 : 1}"`);
    });
  });

  it("the Example sheet has the heading and the example rows", () => {
    const rows = files["xl/worksheets/sheet2.xml"].match(/<row /g)?.length;
    expect(rows).toBe(1 + spec.examples.length);
  });

  it("every choice column has a dropdown over its own column of the Lists sheet", () => {
    const data = files["xl/worksheets/sheet1.xml"];
    let list = 0;
    spec.columns.forEach((c, i) => {
      const L = columnLetter(i);
      if (c.options?.length) {
        const LL = columnLetter(list++);
        expect(data).toContain(`sqref="${L}2:${L}2000"><formula1>Lists!$${LL}$2:$${LL}$${c.options.length + 1}</formula1>`);
      } else if (c.kind === "bool") {
        expect(data).toContain(`sqref="${L}2:${L}2000"><formula1>&quot;Yes,No&quot;</formula1>`);
      } else {
        expect(data).not.toContain(`sqref="${L}2:${L}2000"`);
      }
    });
  });

  it("the hidden Lists sheet holds the allowed values of every choice column", () => {
    const lists = files["xl/worksheets/sheet3.xml"];
    for (const c of spec.columns) for (const o of c.options ?? []) expect(lists).toContain(o.label.replace(/&/g, "&amp;"));
  });

  it("keeps the heading row frozen on Data and Example", () => {
    expect(files["xl/worksheets/sheet1.xml"]).toContain('state="frozen"');
    expect(files["xl/worksheets/sheet2.xml"]).toContain('state="frozen"');
  });
});

describe("text that XML cannot carry", () => {
  it("is escaped, and control characters are dropped", () => {
    const spec = { ...tasksSpec, examples: [{ title: 'A & B <c> "d"\u0001' }] };
    const files = unzip(buildSampleWorkbook(spec));
    const example = files["xl/worksheets/sheet2.xml"];
    expect(example).toContain("A &amp; B &lt;c&gt; &quot;d&quot;");
    expect(example).not.toContain("\u0001");
  });
});
