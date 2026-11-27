/**
 * Every Tasks tab shows how many tasks it lists (2026-11-26), not Overdue alone. Source-wiring
 * checks: a tab's rows and its count come from the one definition, so they cannot drift.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Tasks tab counts", () => {
  const page = read("src/app/dashboard/tasks/page.tsx");

  it("counts all five tabs from the same conditions the list uses", () => {
    expect(page).toContain("const tabCond: Record<Tab, any> = {");
    for (const t of ['""', '"overdue"', '"today"', '"upcoming"', '"completed"']) expect(page).toContain(`countOf(${t})`);
    expect(page).toContain("listConds.push(tabCond[tab]);");
  });

  it("leaves the Status and Due filters out of the other tabs' counts, since clicking a tab clears them", () => {
    expect(page).toContain("listConds.push(inArray(tasks.status, statusFilter as any));");
    expect(page).toContain("listConds.push(dueConds.length === 1 ? dueConds[0] : or(...dueConds)!);");
    expect(page).toContain("if (!isKanban) tabCounts[tab] = total;");
  });

  it("shows a count on every tab, red only for overdue work", () => {
    const view = read("src/app/dashboard/tasks/TaskViewSelect.tsx");
    expect(view).toContain("counts[t.value]");
    expect(view).not.toContain('{t.value === "overdue" && (');
    expect(view).toContain('t.value === "overdue" && counts[t.value] > 0');
  });
});
