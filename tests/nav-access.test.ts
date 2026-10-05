/**
 * knownNavKeys — a saved sidebar grant may still carry hrefs of items that
 * have since been removed from the sidebar (Pipeline Board, Operations, …).
 * Saving such a user used to fail with "one or more sidebar items are not
 * recognised"; the stale keys are now dropped instead.
 */
import { describe, expect, it } from "vitest";
import { knownNavKeys } from "@/config/nav-access";

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
