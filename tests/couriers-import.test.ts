/**
 * Couriers — the Excel / CSV import: its sheet, the two sample files, and how a
 * row is read. No database.
 */
import { describe, expect, it } from "vitest";
import { COURIER_LABELS } from "@/lib/couriers/entry";
import { couriersImport } from "@/lib/imports/sheet/couriers";
import { decodeText, parseCsv } from "@/lib/imports/sheet/csv";
import { gridToRows } from "@/lib/imports/sheet/grid";
import { RowView, type Problem } from "@/lib/imports/sheet/run";
import { matchHeaders } from "@/lib/imports/sheet/spec";
import { couriersSpec } from "@/lib/imports/sheet/specs/couriers";
import { buildSampleCsv, buildSampleWorkbook, sampleFileName } from "@/lib/imports/sheet/write";

const session = { tenantId: "t", userId: "u", roles: ["owner"] } as any;

function read(cells: Record<string, string>) {
  const problems: Problem[] = [];
  const view = new RowView(2, cells, (k) => couriersSpec.columns.find((c) => c.key === k)?.header ?? k, problems);
  const item = couriersImport.parse(view, null, session);
  return { item, columns: problems.map((p) => p.column), problems };
}

const base = { courierType: "Inward", courierDate: "24/11/2026", status: "Received" };

describe("the sheet", () => {
  it("has every field once, under the screen's own headings", () => {
    expect([...couriersSpec.columns.map((c) => c.header)].sort()).toEqual([...Object.values(COURIER_LABELS)].sort());
    expect(couriersSpec.columns.filter((c) => c.required).map((c) => c.header)).toEqual(["Courier Type", "Courier Date", "Courier Status"]);
  });

  it("offers both sample files", () => {
    expect(sampleFileName(couriersSpec)).toBe("couriers-import-sample.xlsx");
    expect(sampleFileName(couriersSpec, "csv")).toBe("couriers-import-sample.csv");
    expect(buildSampleWorkbook(couriersSpec).subarray(0, 2).toString()).toBe("PK");
  });

  it("reads its own CSV sample back, every column recognised", () => {
    const sheet = gridToRows(parseCsv(decodeText(buildSampleCsv(couriersSpec))), "CSV");
    if ("error" in sheet) throw new Error(sheet.error);
    const match = matchHeaders(sheet.headers, couriersSpec);
    expect(match.missing).toEqual([]);
    expect(match.ignored).toEqual([]);
    expect(Object.keys(match.map)).toHaveLength(couriersSpec.columns.length);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0].cells["Sender Address"]).toBe("12 Sample Road, Ahmedabad");
  });

  it("accepts the shorter headings people type", () => {
    const match = matchHeaders(["Type", "Date", "Status", "AWB", "Courier Service", "Category", "Charges", "Document Details"], couriersSpec);
    expect(match.missing).toEqual([]);
    expect(match.ignored).toEqual([]);
  });
});

describe("a row", () => {
  it("is read like the form: day-first dates, choices by their words", () => {
    const { item, problems } = read({
      ...base, category: "kyc documents", senderName: "Meera Shah", senderMobile: "98765 43210", receivedDate: "25-11-2026",
    });
    expect(problems).toEqual([]);
    expect(item).toMatchObject({
      courierType: "inward", courierDate: "2026-11-24", status: "received", category: "kyc_documents",
      senderName: "Meera Shah", receivedDate: "2026-11-25", recipientName: null,
    });

    const out = read({
      courierType: "outward", courierDate: "2026-11-24", status: "In Transit", category: "Other", categoryOther: "Calendars",
      courierCharges: "Rs. 1,200", paymentMode: "bank transfer", dispatchDate: "24-11-2026", deliveredDate: "26 Nov 2026",
    });
    expect(out.problems).toEqual([]);
    expect(out.item).toMatchObject({
      status: "in_transit", category: "other", categoryOther: "Calendars", courierCharges: "1200",
      paymentMode: "bank_transfer", deliveredDate: "2026-11-26",
    });
  });

  it("each example row is a good row once renumbered, so the sample teaches the real format", () => {
    for (const example of couriersSpec.examples) {
      const { item, problems } = read({ ...example, trackingNumber: "AWB 1" });
      expect(problems).toEqual([]);
      expect(item).not.toBeNull();
    }
  });

  it("an untouched example row is never imported", () => {
    for (const example of couriersSpec.examples) {
      const { item, problems } = read(example);
      expect(item).toBeNull();
      expect(problems[0].message).toContain("example row");
    }
  });

  it("refuses the other side's details rather than dropping them", () => {
    expect(read({ ...base, recipientName: "R", courierCharges: "5" }).columns).toEqual(["Recipient Name", "Courier Charges"]);
    expect(read({ ...base, courierType: "Outward", status: "Pending", senderName: "S" }).columns).toEqual(["Sender Name"]);
  });

  it("holds the status and category to the type's rules", () => {
    expect(read({ ...base, status: "Delivered" }).columns).toEqual(["Courier Status"]);
    expect(read({ ...base, category: "Other" }).columns).toEqual(["Other Category"]);
    expect(read({ ...base, category: "Cheque", categoryOther: "x" }).columns).toEqual(["Other Category"]);
  });

  it("reports every missing or unreadable cell against its column", () => {
    expect(read({}).columns).toEqual(["Courier Type", "Courier Date", "Courier Status"]);
    expect(read({ ...base, courierDate: "31-02-2026", status: "Eaten", category: "Furniture" }).columns).toEqual(
      ["Courier Date", "Courier Status", "Courier Category"],
    );
    expect(read({ ...base, senderEmail: "nope", senderMobile: "12" }).columns.sort()).toEqual(["Sender Email", "Sender Mobile"]);
  });
});
