/**
 * "Select all N matching" on the SIP Rejections list (2026-11-25) must select exactly the rows the page counts, so the page
 * and the ids route have to share ONE filter (lib/sip-rejections/list-filter) — these keep them from drifting apart.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SIP_REJECTION_BULK_MAX } from "@/lib/sip-rejections/list-filter";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("SIP Rejections select-all-matching", () => {
  it("the page and the ids route both take the list's filter from the shared module", () => {
    expect(read("src/app/dashboard/sip-rejections/page.tsx")).toContain("sipRejectionWhere(tx, session, sp)");
    expect(read("src/app/api/sip-rejections/ids/route.ts")).toContain("sipRejectionWhere(tx, session, sp)");
  });

  it("the page no longer builds its own filters (a second copy is how the two would disagree)", () => {
    const page = read("src/app/dashboard/sip-rejections/page.tsx");
    for (const own of ["recoveryFilter", "branchIds", "dateRangeCond(", "visibleClientSql("]) expect(page).not.toContain(own);
  });

  it("the ids route never hands back more than one bulk action takes", () => {
    const bulk = read("src/app/api/sip-rejections/bulk/route.ts");
    expect(bulk).toContain(`.max(${SIP_REJECTION_BULK_MAX})`);
  });

  it("the table clears an 'all matching' selection when a single row is ticked or the page changes", () => {
    const table = read("src/components/sip-rejections/SipRejectionsTable.tsx");
    expect(table).toContain("setAllMatching(null)");
    expect(read("src/app/dashboard/sip-rejections/page.tsx")).toContain("key={`${data.page}|");
  });

  it("scheme and reason are drawn in full, and a row opens its details card", () => {
    const table = read("src/components/sip-rejections/SipRejectionsTable.tsx");
    const sip = table.slice(table.indexOf('case "sip":'), table.indexOf('case "amount":'));
    const reason = table.slice(table.indexOf('case "reason":'), table.indexOf('case "rm":'));
    expect(sip).not.toContain("truncate");
    expect(reason).not.toContain("truncate");
    expect(table).toContain("openFromRowClick(e, r.id)");
    expect(table).toContain("<DialogContent");
  });
});
