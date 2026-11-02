import { describe, expect, it } from "vitest";
import { REDEMPTION_ROUTE_CHECKLISTS, REQUEST_TYPE_BY_KEY } from "@/lib/tasks/request-types";
import { FEATURE_FLAGS, sanitizeFeatureFlagOverride } from "@/config/feature-flags";

describe("redemption Online / Offline sub-tasks (per-firm flag)", () => {
  it("offline is the six paper steps, online the four platform steps", () => {
    expect(REDEMPTION_ROUTE_CHECKLISTS.offline).toEqual([
      "Redemption slip to client",
      "Redemption received from client",
      "Sign redemption slip",
      "Send to AMC",
      "RTA data check",
      "Payment check with client",
    ]);
    expect(REDEMPTION_ROUTE_CHECKLISTS.online).toEqual([
      "Entry on platform",
      "Make client confirm",
      "RTA data check",
      "Payment goes to client",
    ]);
  });

  it("is a flag a super admin can set per firm, and the default redemption list is untouched", () => {
    expect(FEATURE_FLAGS.some((f) => f.key === "redemptionOnlineOffline" && f.type === "boolean")).toBe(true);
    expect(sanitizeFeatureFlagOverride({ redemptionOnlineOffline: true })).toEqual({ redemptionOnlineOffline: true });
    expect(REQUEST_TYPE_BY_KEY.redemption.checklist).not.toEqual(REDEMPTION_ROUTE_CHECKLISTS.offline);
    expect(REQUEST_TYPE_BY_KEY.redemption.checklist.length).toBeGreaterThan(0);
  });
});
