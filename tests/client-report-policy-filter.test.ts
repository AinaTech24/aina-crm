import { describe, expect, it } from "vitest";
import { parsePolicyFilter } from "@/lib/investors/client-report-sections";

const q = (s: string) => new URLSearchParams(s);

describe("client report — which insurance policies", () => {
  it("no choice means every policy", () => {
    expect(parsePolicyFilter(q(""))).toEqual({ statuses: null, types: null });
  });
  it("reads statuses and types, drops anything that is not a plain key", () => {
    expect(parsePolicyFilter(q("insStatus=active,lapsed&insType=health,term"))).toEqual({ statuses: ["active", "lapsed"], types: ["health", "term"] });
    expect(parsePolicyFilter(q("insStatus=active,x';drop&insType=Health"))).toEqual({ statuses: ["active"], types: null });
  });
});
