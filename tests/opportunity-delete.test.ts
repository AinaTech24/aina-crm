/**
 * Deleting an opportunity (2026-11-25): from its page and in bulk from the list, like Business Entries.
 * Source-wiring checks — the rules that must not drift.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("opportunity delete", () => {
  const del = read("src/lib/opportunities/delete.ts");

  it("tidies what the opportunity leaves behind instead of orphaning it", () => {
    expect(del).toContain("SET status = 'cancelled'"); // open tasks end
    expect(del).toContain("UPDATE expected_inflows SET status = 'cancelled'"); // the money it waited for
    expect(del).toContain("UPDATE proposals SET opportunity_id = NULL"); // proposals keep standing
    expect(del).toContain("DELETE FROM blueprint_instances"); // the journey (history cascades)
    expect(del).toContain("DELETE FROM client_opportunities");
    expect(del).toContain('action: "opportunity.delete"'); // audited
  });

  it("only deletes what the viewer may see and own — a firm-wide viewer or owner may delete any", () => {
    expect(del).toContain("loadViewableOpportunity");
    expect(del).toContain("investor.view.all");
    expect(del).toContain("opp.ownerId === session.userId || opp.createdBy === session.userId");
  });

  it("both routes are gated and call the one delete", () => {
    const one = read("src/app/api/opportunities/[id]/route.ts");
    const bulk = read("src/app/api/opportunities/bulk/route.ts");
    expect(one).toContain("export async function DELETE");
    for (const src of [one, bulk]) {
      expect(src).toContain("requireWorkOpportunities(session)");
      expect(src).toContain("deleteOpportunities(");
    }
    expect(bulk).toContain('action: z.literal("delete")');
  });

  it("the list offers the selection bar to people who can work opportunities, and the page has a trash button", () => {
    expect(read("src/components/opportunities/OpportunitiesTable.tsx")).toContain('endpoint="/api/opportunities/bulk"');
    expect(read("src/app/dashboard/opportunities/page.tsx")).toContain("canDelete={canWork}");
    expect(read("src/app/dashboard/opportunities/[id]/page.tsx")).toContain("<DeleteOpportunityButton");
    expect(read("src/components/opportunities/DeleteOpportunityButton.tsx")).toContain('method: "DELETE"');
  });
});
