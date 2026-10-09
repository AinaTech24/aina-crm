/**
 * knownNavKeys — a saved sidebar grant may still carry hrefs of items that
 * have since been removed from the sidebar (Pipeline Board, Operations, …).
 * Saving such a user used to fail with "one or more sidebar items are not
 * recognised"; the stale keys are now dropped instead.
 */
import { describe, expect, it } from "vitest";
import { gatedNavKeyForPath, isGatableNav, knownNavKeys, tenantAccessibleNavKeys } from "@/config/nav-access";

describe("knownNavKeys", () => {
  it("drops hrefs that are no longer in the sidebar catalog", () => {
    expect(
      knownNavKeys(["/dashboard/tasks", "/dashboard/pipeline-board", "/dashboard/operations", "/dashboard/leads"])
    ).toEqual(["/dashboard/tasks", "/dashboard/leads"]);
  });

  it("keeps null (inherit) and undefined (not sent) as they are", () => {
    expect(knownNavKeys(null)).toBeNull();
    expect(knownNavKeys(undefined)).toBeUndefined();
  });

  it("returns an empty grant when every key is stale", () => {
    expect(knownNavKeys(["/dashboard/boards"])).toEqual([]);
  });
});

describe("Opportunities comes with Clients", () => {
  it("is gated by the Clients grant, on the module page and on one opportunity", () => {
    expect(gatedNavKeyForPath("/dashboard/opportunities")).toBe("/dashboard/investors");
    expect(gatedNavKeyForPath("/dashboard/opportunities/0b1c")).toBe("/dashboard/investors");
  });

  it("shows for a firm whose explicit list names Clients but predates Opportunities", () => {
    const keys = tenantAccessibleNavKeys({ allowedNav: ["/dashboard/investors", "/dashboard/leads"], enabledModules: [] });
    expect(keys).toContain(gatedNavKeyForPath("/dashboard/opportunities"));
  });

  it("is not a grant of its own", () => {
    expect(isGatableNav("/dashboard/opportunities")).toBe(false);
  });
});
