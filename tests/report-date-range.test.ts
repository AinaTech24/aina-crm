import { describe, expect, it } from "vitest";
import { withDateRange } from "@/lib/reports/range";
import { compileToSql } from "@/lib/filter/compiler";

describe("custom report — Filter by date range", () => {
  it("narrows a datetime field to whole India days, both ends inclusive", () => {
    const ast = withDateRange("review_meeting", null, { field: "meeting_date", from: "2026-10-01", to: "2026-10-31" });
    const c = compileToSql(ast!, "review_meeting");
    expect(c.sql).toBe("(mtg.meeting_date >= $1 AND mtg.meeting_date < $2)");
    expect(c.params).toEqual(["2026-10-01T00:00:00+05:30", "2026-11-01T00:00:00+05:30"]);
  });
  it("keeps the saved filter and adds the range to it", () => {
    const saved = { type: "group" as const, op: "AND" as const, children: [] };
    const ast: any = withDateRange("review_meeting", saved, { field: "meeting_date", from: "2026-10-01", to: null });
    expect(ast.children.length).toBe(2);
  });
  it("ignores a range with no usable dates and refuses a non-date field", () => {
    expect(withDateRange("review_meeting", null, { field: "meeting_date", from: "01/10/2026", to: "" })).toBeNull();
    expect(() => withDateRange("review_meeting", null, { field: "status", from: "2026-10-01", to: null })).toThrow();
  });
});
