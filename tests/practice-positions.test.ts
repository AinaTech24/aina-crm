/**
 * Positions and owner dependency — the pure rules: a position's key from its
 * title, unique within the firm; how dependent on the owner the firm is.
 */

import { describe, expect, it } from "vitest";
import { positionKey, uniqueKey, PositionCreateBody, PositionPatchBody, PositionHoldersBody } from "@/lib/practice/positions";
import { dependencyLevel, dependencyShares, type OwnerDependency } from "@/lib/metrics/owner-dependency";
import { DEFAULT_POSITIONS, PRACTICE_PROCESSES } from "@/lib/practice/catalog";

const dep = (over: Partial<OwnerDependency> = {}): OwnerDependency => ({
  ownerCount: 1,
  clientsOwnedByOwner: 0, totalLiveClients: 100,
  openTasksAssignedToOwner: 0, totalOpenTasks: 100,
  positionsFilledOnlyByOwner: 0, totalPositions: 10,
  processesOwnedByOwnerOnly: 0, totalProcesses: 10,
  ...over,
});

describe("positionKey", () => {
  it("makes lower snake case from a title", () => {
    expect(positionKey("Relationship Manager")).toBe("relationship_manager");
    expect(positionKey("Owner / Director")).toBe("owner_director");
    expect(positionKey("  Head — Insurance & Claims!! ")).toBe("head_insurance_and_claims");
    expect(positionKey("Café Manager")).toBe("cafe_manager");
  });

  it("falls back when nothing usable is left, and stays short", () => {
    expect(positionKey("!!!")).toBe("position");
    expect(positionKey("")).toBe("position");
    const long = positionKey("a very long position title ".repeat(10));
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith("_")).toBe(false);
  });

  it("matches the keys of the default positions", () => {
    for (const p of DEFAULT_POSITIONS.filter((d) => d.key !== "operations_executive" && d.key !== "compliance_officer" && d.key !== "marketing_executive")) {
      expect(positionKey(p.title), p.key).toBe(p.key);
    }
  });

  it("is made unique within the firm", () => {
    expect(uniqueKey("rm", [])).toBe("rm");
    expect(uniqueKey("rm", ["rm"])).toBe("rm_2");
    expect(uniqueKey("rm", ["rm", "rm_2", "rm_3"])).toBe("rm_4");
    expect(uniqueKey("rm", ["rm_2"])).toBe("rm");
  });
});

describe("Position API bodies", () => {
  it("validate create, patch and holders", () => {
    expect(PositionCreateBody.safeParse({ title: "X" }).success).toBe(false);
    expect(PositionCreateBody.safeParse({ title: "Paraplanner", results: ["Plans out in 3 days"] }).success).toBe(true);
    expect(PositionPatchBody.safeParse({}).success).toBe(false);
    expect(PositionPatchBody.safeParse({ sort: 20 }).success).toBe(true);
    expect(PositionPatchBody.safeParse({ results: [""] }).success).toBe(false);
    expect(PositionHoldersBody.safeParse({ userIds: [] }).success).toBe(true);
    expect(PositionHoldersBody.safeParse({ userIds: ["nope"] }).success).toBe(false);
  });
});

describe("Default positions and processes", () => {
  it("give every core process a default owner that is a default position", () => {
    const keys = new Set(DEFAULT_POSITIONS.map((p) => p.key));
    for (const p of PRACTICE_PROCESSES) expect(keys.has(p.defaultOwner), p.key).toBe(true);
  });
});

describe("dependencyLevel", () => {
  it("is low when the owner carries little, or nothing can be measured", () => {
    expect(dependencyLevel(dep())).toBe("low");
    expect(dependencyLevel(dep({ clientsOwnedByOwner: 20, openTasksAssignedToOwner: 10 }))).toBe("low");
    expect(dependencyLevel(dep({ totalLiveClients: 0, totalOpenTasks: 0, totalPositions: 0, totalProcesses: 0 }))).toBe("low");
  });

  it("is medium from a quarter on average, or half of any one", () => {
    // avg 0.25 exactly
    expect(dependencyLevel(dep({ clientsOwnedByOwner: 25, openTasksAssignedToOwner: 25, positionsFilledOnlyByOwner: 2.5, processesOwnedByOwnerOnly: 2.5 }))).toBe("medium");
    // one share at 50%, average 12.5%
    expect(dependencyLevel(dep({ clientsOwnedByOwner: 50 }))).toBe("medium");
    // just under both thresholds
    expect(dependencyLevel(dep({ clientsOwnedByOwner: 49, openTasksAssignedToOwner: 49 }))).toBe("low");
  });

  it("is high from half on average, or three quarters of any one", () => {
    expect(dependencyLevel(dep({ clientsOwnedByOwner: 50, openTasksAssignedToOwner: 50, positionsFilledOnlyByOwner: 5, processesOwnedByOwnerOnly: 5 }))).toBe("high");
    expect(dependencyLevel(dep({ positionsFilledOnlyByOwner: 8 }))).toBe("high");
    // A one-person firm: the owner is the RM of every client.
    expect(dependencyLevel(dep({ clientsOwnedByOwner: 100, totalOpenTasks: 0, totalPositions: 0, totalProcesses: 0 }))).toBe("high");
  });

  it("ignores a figure with no whole to be a share of", () => {
    expect(dependencyShares(dep({ totalOpenTasks: 0, totalPositions: 0 }))).toEqual([0, 0]);
    expect(dependencyLevel(dep({ clientsOwnedByOwner: 30, totalLiveClients: 100, totalOpenTasks: 0, totalPositions: 0, totalProcesses: 0 }))).toBe("medium");
  });
});
