/**
 * A client who still holds money with the registrar is never deleted — the
 * person who tried is told what the client holds and what to do instead.
 */
import { describe, expect, it } from "vitest";
import { holdersMessage } from "@/lib/investors/holds-money";

describe("holdersMessage", () => {
  it("names the client, what they hold, and the way out", () => {
    const m = holdersMessage([{ id: "a", name: "Thakor Rushin Jitendrabhai", aum: 2833000, folios: 13, activeSips: 16 }]);
    expect(m).toContain("Thakor Rushin Jitendrabhai (₹28.33 L in 13 folios and 16 active SIPs)");
    expect(m).toContain("This client still holds");
    expect(m).toContain("merge it in Merge Clients");
    expect(m).toContain("Closed or Exited");
  });

  it("a SIP alone is money too; long lists are summarised", () => {
    const list = [1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, name: `Client ${n}`, aum: 0, folios: 0, activeSips: 1 }));
    const m = holdersMessage(list);
    expect(m).toContain("These clients still hold");
    expect(m).toContain("Client 1 (1 active SIP)");
    expect(m).toContain("and 2 more");
    expect(m).not.toContain("Client 4");
  });
});
