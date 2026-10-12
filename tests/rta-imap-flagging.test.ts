/**
 * The IMAP mailback reader must not mark a mail \Seen when handling it failed
 * (A-entry items 10/11): a thrown handler or an "error" outcome leaves the mail
 * unseen and \Flagged — kept for inspection, skipped by the next search so it
 * cannot loop or starve newer mail. Handled mail is \Seen as before. It also
 * hands the handler the message's Authentication-Results in header order and
 * the transport, which the trust rules depend on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  flags: [] as Array<{ uid: string; flags: string[] }>,
  searches: [] as unknown[],
}));

const RAW = Buffer.from(
  [
    "Authentication-Results: amazonses.com; dkim=pass header.d=camsonline.com",
    "Received: from mx.example by inbound.example; Mon, 5 Oct 2026 10:00:00 +0000",
    "Authentication-Results: mx.forwarder.example; dkim=pass header.d=example.net",
    "From: Synthetic <donotreply@camsonline.com>",
    "To: rta-0123456789ab@crm.ainatech.in",
    "Subject: synthetic",
    "Message-ID: <synthetic-1@example.test>",
    "",
    "body",
    "",
  ].join("\r\n")
);

vi.mock("imapflow", () => ({
  ImapFlow: class {
    on() {}
    async connect() {}
    async logout() {}
    async getMailboxLock() {
      return { release() {} };
    }
    async search(q: unknown) {
      state.searches.push(q);
      return [1, 2];
    }
    async *fetch() {
      yield { uid: 1, source: RAW, envelope: {} };
      yield { uid: 2, source: RAW, envelope: {} };
    }
    async messageFlagsAdd(uid: string, flags: string[]) {
      state.flags.push({ uid, flags });
    }
  },
}));

import { processUnseenMailback, type InboundRawMessage } from "@/lib/comms/imap";

const cfg = { host: "imap.example", port: 993, secure: true, user: "u", pass: "p" };

beforeEach(() => {
  state.flags.length = 0;
  state.searches.length = 0;
});

describe("processUnseenMailback", () => {
  it("flags (not \\Seen) a mail whose handler threw or reported an error; \\Seen otherwise", async () => {
    const seen: InboundRawMessage[] = [];
    await processUnseenMailback(cfg, async (msg) => {
      seen.push(msg);
      if (msg.uid === 1) throw new Error("db down");
      msg.outcome = "imported";
    });
    expect(state.flags).toEqual([
      { uid: "1", flags: ["\\Flagged"] },
      { uid: "2", flags: ["\\Seen"] },
    ]);
    expect(state.searches[0]).toEqual({ seen: false, flagged: false });

    // Authentication-Results reach the handler topmost first, with the transport.
    expect(seen[0].transport).toBe("imap");
    expect(seen[0].authResults[0]).toMatch(/^amazonses\.com; dkim=pass/);
    expect(seen[0].authResults[1]).toMatch(/^mx\.forwarder\.example/);
  });

  it("flags an 'error' outcome and a kept source", async () => {
    await processUnseenMailback(cfg, async (msg) => {
      if (msg.uid === 1) msg.outcome = "error";
      else {
        msg.outcome = "imported";
        msg.keepSource = true;
      }
    });
    expect(state.flags.map((f) => f.flags[0])).toEqual(["\\Flagged", "\\Flagged"]);
  });
});
