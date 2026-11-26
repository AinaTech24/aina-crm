/**
 * Visitor Register — the Excel / CSV import: its sheet, the two sample files,
 * and how a row is read. No database.
 */
import { describe, expect, it } from "vitest";
import { VISITOR_LABELS } from "@/lib/visitors/entry";
import { decodeText, parseCsv } from "@/lib/imports/sheet/csv";
import { gridToRows } from "@/lib/imports/sheet/grid";
import { UserLookup } from "@/lib/imports/sheet/lookups";
import { RowView, type Problem } from "@/lib/imports/sheet/run";
import { matchHeaders } from "@/lib/imports/sheet/spec";
import { visitorsSpec } from "@/lib/imports/sheet/specs/visitors";
import { visitorsImport } from "@/lib/imports/sheet/visitors";
import { buildSampleCsv, buildSampleWorkbook, sampleFileName } from "@/lib/imports/sheet/write";

const kiran = "33333333-3333-4333-8333-333333333333";
const users = new UserLookup([
  { id: kiran, name: "Kiran Patel", email: "kiran@t.in", department: null, branchId: null, roles: ["rm"] },
]);
const session = { tenantId: "t", userId: "u", roles: ["owner"] } as any;

function read(cells: Record<string, string>) {
  const problems: Problem[] = [];
  const view = new RowView(2, cells, (k) => visitorsSpec.columns.find((c) => c.key === k)?.header ?? k, problems);
  const item = visitorsImport.parse(view, { users }, session);
  return { item, columns: problems.map((p) => p.column), problems };
}

describe("the sheet", () => {
  it("has the ten fields under the register's own headings", () => {
    expect(visitorsSpec.columns.map((c) => c.header)).toEqual(Object.values(VISITOR_LABELS));
    expect(visitorsSpec.columns.filter((c) => c.required).map((c) => c.header)).toEqual(["Visitor Name", "Visit Date"]);
  });

  it("offers both sample files", () => {
    expect(sampleFileName(visitorsSpec)).toBe("visitors-import-sample.xlsx");
    expect(sampleFileName(visitorsSpec, "csv")).toBe("visitors-import-sample.csv");
    expect(buildSampleWorkbook(visitorsSpec).subarray(0, 2).toString()).toBe("PK");
  });

  it("reads its own CSV sample back, every column recognised", () => {
    const sheet = gridToRows(parseCsv(decodeText(buildSampleCsv(visitorsSpec))), "CSV");
    if ("error" in sheet) throw new Error(sheet.error);
    const match = matchHeaders(sheet.headers, visitorsSpec);
    expect(match.missing).toEqual([]);
    expect(match.ignored).toEqual([]);
    expect(Object.keys(match.map)).toHaveLength(10);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0].cells["Visit Date *"]).toBe("24-11-2026");
    expect(sheet.rows[0].cells["Mobile Number"]).toBe("98765 43210");
  });

  it("accepts the shorter headings people type", () => {
    const match = matchHeaders(["Name", "Date", "Phone", "In Time", "Out Time", "Purpose", "Person to Meet"], visitorsSpec);
    expect(match.missing).toEqual([]);
    expect(match.ignored).toEqual([]);
  });
});

describe("a row", () => {
  it("is read like the form: day-first date, 12 or 24 hour times, the team member by email or name", () => {
    for (const who of ["kiran@t.in", "kiran patel"]) {
      const { item, problems } = read({
        visitorName: "Meera Shah", visitDate: "05/11/2026", entryTime: "2:30 pm", exitTime: "15:05",
        meetingWithUserId: who, mobile: "98765 43210", purpose: "KYC",
      });
      expect(problems).toEqual([]);
      expect(item).toMatchObject({
        visitorName: "Meera Shah", visitDate: "2026-11-05", entryTime: "14:30", exitTime: "15:05",
        meetingWithUserId: kiran, mobile: "98765 43210", purpose: "KYC", email: null, companyName: null, remarks: null,
      });
    }
  });

  it("each example row is a good row once renamed, so the sample teaches the real format", () => {
    for (const example of visitorsSpec.examples) {
      const { item, problems } = read({ ...example, visitorName: "A real person" });
      expect(problems).toEqual([]);
      expect(item).not.toBeNull();
    }
  });

  it("an untouched example row is never imported", () => {
    for (const example of visitorsSpec.examples) {
      const { item, problems } = read(example);
      expect(item).toBeNull();
      expect(problems[0].message).toContain("example row");
    }
  });

  it("reports every bad cell against its column", () => {
    const { item, columns } = read({
      visitorName: "", visitDate: "31-02-2026", email: "nope", mobile: "12", entryTime: "noon", meetingWithUserId: "Nobody",
    });
    expect(item).toBeNull();
    expect([...new Set(columns)].sort()).toEqual(
      ["Email", "Entry Time", "Meeting with", "Mobile Number", "Visit Date", "Visitor Name"].sort(),
    );
  });

  it("refuses a missing date and an exit before the entry", () => {
    expect(read({ visitorName: "A" }).columns).toEqual(["Visit Date"]);
    expect(read({ visitorName: "A", visitDate: "2026-11-24", entryTime: "11:00", exitTime: "10:00" }).columns).toEqual(["Exit Time"]);
  });
});
