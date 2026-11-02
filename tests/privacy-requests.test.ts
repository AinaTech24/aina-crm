import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { leads } from "@/db/schema";
import {
  LEAD_ERASE_PATCH,
  RESPONSE_DAYS,
  daysLeft,
  dueAtFor,
  requestReference,
  retentionVerdict,
  taskDueFor,
} from "@/lib/privacy/requests-core";

const DAY = 86_400_000;

describe("the 90-day clock", () => {
  it("is due 90 days after receipt, and the task 15 days before that", () => {
    const received = new Date("2026-11-02T05:00:00Z");
    const due = dueAtFor(received);
    expect((due.getTime() - received.getTime()) / DAY).toBe(RESPONSE_DAYS);
    expect((due.getTime() - taskDueFor(due, received).getTime()) / DAY).toBe(15);
  });

  it("a late-logged request's task is due now, never in the past", () => {
    const now = new Date("2026-11-02T05:00:00Z");
    const due = new Date(now.getTime() + 5 * DAY);
    expect(taskDueFor(due, now).getTime()).toBe(now.getTime());
  });

  it("counts days left in India time, negative once overdue", () => {
    const now = new Date("2026-11-02T18:00:00Z"); // 23:30 IST on 2 Nov
    expect(daysLeft(new Date("2026-11-02T19:00:00Z"), now)).toBe(1); // 00:30 IST on 3 Nov
    expect(daysLeft(new Date("2026-10-30T06:00:00Z"), now)).toBe(-3);
  });

  it("numbers requests per year", () => {
    expect(requestReference(2026, 7)).toBe("PR-2026-0007");
  });
});

describe("what an erasure request can do for a client", () => {
  const now = new Date("2026-11-02T00:00:00Z");

  it("never erases someone who still holds money", () => {
    const v = retentionVerdict({ holdsMoney: true, hasFinancialRecords: true, status: "exited", exitedAt: new Date("2015-01-01") }, now);
    expect(v.kind).toBe("blocked");
  });

  it("erases a client who never had a folio or a transaction", () => {
    expect(retentionVerdict({ holdsMoney: false, hasFinancialRecords: false, status: "active", exitedAt: null }, now).kind).toBe("erase");
  });

  it("asks to exit a current client first", () => {
    const v = retentionVerdict({ holdsMoney: false, hasFinancialRecords: true, status: "active", exitedAt: null }, now);
    expect(v.kind).toBe("blocked");
    if (v.kind === "blocked") expect(v.reason).toContain("Mark them as exited");
  });

  it("keeps a former client's records for five years after they left", () => {
    const v = retentionVerdict({ holdsMoney: false, hasFinancialRecords: true, status: "exited", exitedAt: new Date("2024-03-15T00:00:00Z") }, now);
    expect(v.kind).toBe("retain");
    if (v.kind === "retain") expect(v.until.toISOString().slice(0, 10)).toBe("2029-03-15");
  });

  it("erases once the five years are over", () => {
    expect(retentionVerdict({ holdsMoney: false, hasFinancialRecords: true, status: "closed", exitedAt: new Date("2021-01-10") }, now).kind).toBe("erase");
  });
});

describe("erasing a lead", () => {
  // Columns that describe the enquiry, not the person — they stay so the
  // pipeline and source reports do not change.
  const NOT_PERSONAL = new Set([
    "source", "sourceCampaign", "stage", "pipeline", "onboardingRoute", "rtaSubmission", "pipelineStage",
    "score", "scoreBand", "interestProducts", "intendedAmount", "aumPotential", "leadType", "lostReason",
  ]);

  it("blanks every text or json column that can hold personal data", () => {
    const cols = getTableColumns(leads);
    const personal = Object.entries(cols)
      .filter(([, c]) => ["PgText", "PgJsonb", "PgVarchar"].includes((c as { columnType: string }).columnType))
      .map(([k]) => k)
      .filter((k) => !NOT_PERSONAL.has(k));
    const missing = personal.filter((k) => !(k in LEAD_ERASE_PATCH));
    expect(missing).toEqual([]);
  });

  it("leaves nothing that names them", () => {
    expect(LEAD_ERASE_PATCH.name).toBe("Erased lead");
    expect(LEAD_ERASE_PATCH.email).toBeNull();
    expect(LEAD_ERASE_PATCH.phone).toBeNull();
    expect(LEAD_ERASE_PATCH.pan).toBeNull();
  });
});
