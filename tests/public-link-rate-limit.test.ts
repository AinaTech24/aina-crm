/**
 * The public share links are per-CLIENT, but their rate limit was per-IP.
 *
 * A firm profiling its own book — an RM at a desk, a branch onboarding day, or
 * simply clients behind one office NAT — shares a single bucket, so the cap
 * read as "you may serve N clients an hour", not "a bot may try N times". VSN
 * hit it on the risk-profile form; document collection was capped at ten.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  enforceLinkToken,
  PUBLIC_LINK_IP_CEILING,
} from "@/lib/rate-limit";

/** Distinct scope per test so the module-level bucket Map cannot leak between them. */
let n = 0;
const scope = () => `test.scope.${++n}.${Date.now()}`;

describe("PUBLIC_LINK_IP_CEILING", () => {
  it("is wide enough that a working office never reaches it", () => {
    // 20 clients/hour was the old risk-profile cap; 10 was document collection.
    expect(PUBLIC_LINK_IP_CEILING.limit).toBeGreaterThanOrEqual(300);
    expect(PUBLIC_LINK_IP_CEILING.windowSec).toBe(3600);
  });

  it("still stops a bot eventually — it is a brake, not an open door", () => {
    const s = scope();
    const ip = "203.0.113.9";
    for (let i = 0; i < PUBLIC_LINK_IP_CEILING.limit; i++) {
      expect(checkRateLimit(s, ip, PUBLIC_LINK_IP_CEILING).ok).toBe(true);
    }
    expect(checkRateLimit(s, ip, PUBLIC_LINK_IP_CEILING).ok).toBe(false);
  });
});

describe("enforceLinkToken", () => {
  it("lets a whole office serve many DIFFERENT clients — the actual bug", () => {
    const s = scope();
    // 50 clients, one after another from the same office. Previously the 21st
    // risk profile (or the 11th document request) was refused.
    for (let i = 0; i < 50; i++) {
      expect(enforceLinkToken(s, `token-for-client-${i}`, 12)).toBeNull();
    }
  });

  it("still locks down repeated attempts against ONE link", () => {
    const s = scope();
    for (let i = 0; i < 12; i++) expect(enforceLinkToken(s, "one-token", 12)).toBeNull();
    const blocked = enforceLinkToken(s, "one-token", 12);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
  });

  it("sends Retry-After so the form can say when to come back", () => {
    const s = scope();
    for (let i = 0; i < 3; i++) enforceLinkToken(s, "t", 3);
    const blocked = enforceLinkToken(s, "t", 3)!;
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(Number(blocked.headers.get("X-RateLimit-Limit"))).toBe(3);
  });

  it("one client exhausting their link does not touch anyone else's", () => {
    const s = scope();
    for (let i = 0; i < 5; i++) enforceLinkToken(s, "noisy", 5);
    expect(enforceLinkToken(s, "noisy", 5)).not.toBeNull();
    expect(enforceLinkToken(s, "quiet", 5)).toBeNull();
  });

  it("does not bucket an empty token — the route rejects it a line later", () => {
    expect(enforceLinkToken(scope(), "", 1)).toBeNull();
  });
});
