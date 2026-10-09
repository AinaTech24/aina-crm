import { describe, expect, it } from "vitest";
import type { InboundEmail } from "@/lib/comms/imap";
import {
  INBOUND_LIMITS,
  classifyIngestError,
  cleanText,
  ingestInboundBatch,
  safeMessageRef,
  sanitizeInbound,
  type IngestDeps,
  type SanitizedInbound,
} from "@/lib/comms/inbound-ingest";

const TENANT = "11111111-1111-4111-8111-111111111111";

/** A Postgres error as node-postgres raises it, wrapped the way drizzle wraps it. */
function pgError(code: string, constraint?: string) {
  const cause = Object.assign(new Error("pg"), { code, constraint });
  return Object.assign(new Error("Failed query: insert into communications … params: <values>"), { cause });
}

function msg(uid: number, extra: Partial<InboundEmail> = {}): InboundEmail {
  return { uid, messageId: `<m${uid}@example.test>`, from: "client@example.test", subject: `s${uid}`, text: "hello", date: new Date("2026-10-09T03:00:00Z"), ...extra };
}

/**
 * In-memory store mirroring the poller: a row has external_id (may be null) and
 * message_id; the duplicate check matches either, like the real query.
 */
function fakeDeps(opts: { existing?: string[]; failWith?: (m: SanitizedInbound, externalId: string | null) => unknown } = {}) {
  const stored: { uid: number; ext: string | null; ref: string; m: SanitizedInbound }[] = [];
  const dupChecks: string[] = [];
  const existing = new Set(opts.existing ?? []);
  const deps: IngestDeps = {
    alreadyIngested: async (ext) => {
      dupChecks.push(ext);
      return existing.has(ext);
    },
    savepoint: (fn) => fn(),
    store: async (m, externalId, ref) => {
      const err = opts.failWith?.(m, externalId);
      if (err) throw err;
      stored.push({ uid: m.uid, ext: externalId, ref, m });
      existing.add(ref); // found again by external_id or message_id
    },
  };
  return { deps, stored, dupChecks };
}

describe("inbound email ingest: one message never blocks the mailbox", () => {
  it("holds a malformed message and still stores the valid message after it", async () => {
    const { deps, stored } = fakeDeps({ failWith: (m) => (m.uid === 2 ? pgError("22P05") : undefined) });
    const res = await ingestInboundBatch([msg(1), msg(2), msg(3)], deps, { tenantId: TENANT });
    expect(stored.map((s) => s.uid)).toEqual([1, 3]);
    expect(res.ingested).toBe(2);
    expect(res.held).toHaveLength(1);
    expect(res.held[0]).toMatchObject({ uid: 2, code: "22P05", reason: "bad_message" });
    // The high-water mark moves past the held message: no retry loop.
    expect(res.maxUid).toBe(3);
  });

  it("stores a message with missing fields under a per-mailbox UID key", async () => {
    const { deps, stored } = fakeDeps();
    const bare = { uid: 7 } as InboundEmail;
    const res = await ingestInboundBatch([bare], deps, { tenantId: TENANT });
    expect(res.ingested).toBe(1);
    expect(stored[0].ext).toBe(`imap-${TENANT}-7`);
    expect(stored[0].m).toMatchObject({ messageId: null, subject: null, text: null, from: null, receivedAt: null, hasHtml: false });
  });

  it("cleans and caps oversized or unexpected fields instead of failing", async () => {
    const { deps, stored } = fakeDeps();
    const huge = "x".repeat(INBOUND_LIMITS.text + 5_000);
    const weird = msg(4, {
      text: `a\u0000b${huge}`,
      subject: `bad \uD800 surrogate \u0000`,
      references: "r ".repeat(10_000),
      date: new Date("not a date"),
      fromName: 12345 as unknown as string, // not a string at all
    });
    const res = await ingestInboundBatch([weird], deps, { tenantId: TENANT });
    expect(res.ingested).toBe(1);
    const m = stored[0].m;
    expect(m.text!.length).toBe(INBOUND_LIMITS.text);
    expect(m.text).not.toContain("\u0000");
    expect(m.subject).not.toContain("\u0000");
    expect(m.subject).toContain("�");
    expect(m.references!.length).toBeLessThanOrEqual(INBOUND_LIMITS.references);
    expect(m.receivedAt).toBeNull();
    expect(m.fromName).toBe("12345");
    expect(m.altered).toBe(true);
  });

  it("skips a message already stored (idempotent re-fetch)", async () => {
    const already = "<m5@example.test>";
    const { deps, stored, dupChecks } = fakeDeps({ existing: [already] });
    const res = await ingestInboundBatch([msg(5), msg(5)], deps, { tenantId: TENANT });
    expect(stored).toHaveLength(0);
    expect(res.skippedDuplicates).toBe(2);
    expect(dupChecks[0]).toBe(already);
    expect(res.maxUid).toBe(5);
  });

  it("a valid duplicate inside one batch is stored once", async () => {
    const { deps, stored } = fakeDeps();
    const res = await ingestInboundBatch([msg(6), msg(6, { uid: 8 })], deps, { tenantId: TENANT });
    expect(stored).toHaveLength(1);
    expect(res.skippedDuplicates).toBe(1);
  });

  it("stores a Message-ID another firm already holds with external_id NULL, never a made-up id", async () => {
    const { deps, stored } = fakeDeps({
      failWith: (_m, externalId) => (externalId === null ? undefined : pgError("23505", "comms_external_unique")),
    });
    const res = await ingestInboundBatch([msg(9), msg(10)], deps, { tenantId: TENANT });
    expect(res.ingested).toBe(2);
    expect(res.storedWithoutExternalId).toBe(2);
    expect(stored[0]).toMatchObject({ uid: 9, ext: null, ref: "<m9@example.test>" });
    // Nothing tenant-specific is ever appended to a mail identifier.
    expect(stored.every((s) => !String(s.ref).includes(TENANT))).toBe(true);
    // A re-fetch finds it again by message_id: no duplicate insert.
    const again = await ingestInboundBatch([msg(9)], deps, { tenantId: TENANT });
    expect(again.skippedDuplicates).toBe(1);
    expect(stored).toHaveLength(2);
  });

  it("a transient failure aborts the batch so it is retried, unless the mailbox keeps failing", async () => {
    const failing = () => fakeDeps({ failWith: (m) => (m.uid === 2 ? pgError("57014") : undefined) });
    await expect(ingestInboundBatch([msg(1), msg(2)], failing().deps, { tenantId: TENANT })).rejects.toThrow();
    const res = await ingestInboundBatch([msg(1), msg(2), msg(3)], failing().deps, { tenantId: TENANT, holdOnTransient: true });
    expect(res.held.map((h) => h.uid)).toEqual([2]);
    expect(res.ingested).toBe(2);
    expect(res.maxUid).toBe(3);
  });

  it("processes in UID order whatever order the server returned", async () => {
    const { deps, stored } = fakeDeps();
    const res = await ingestInboundBatch([msg(12), msg(10), msg(11)], deps, { tenantId: TENANT });
    expect(stored.map((s) => s.uid)).toEqual([10, 11, 12]);
    expect(res.maxUid).toBe(12);
  });
});

describe("inbound ingest helpers", () => {
  it("classifies a wrapped drizzle error by its Postgres cause", () => {
    expect(classifyIngestError(pgError("23505", "comms_external_unique"))).toBe("cross_tenant_duplicate");
    expect(classifyIngestError(pgError("23505", "some_other_unique"))).toBe("bad_message");
    expect(classifyIngestError(pgError("08006"))).toBe("transient");
    expect(classifyIngestError(pgError("53300"))).toBe("transient");
    expect(classifyIngestError(pgError("40P01"))).toBe("transient");
    expect(classifyIngestError(new Error("read ECONNRESET"))).toBe("transient");
    expect(classifyIngestError(pgError("22P05"))).toBe("bad_message");
    expect(classifyIngestError(new RangeError("Invalid time value"))).toBe("bad_message");
  });

  it("the safe reference never contains the Message-ID or an address", () => {
    const ref = safeMessageRef("<private-id@client-domain.test>");
    expect(ref).toMatch(/^[0-9a-f]{12}$/);
    expect(ref).not.toContain("client");
  });

  it("an over-long Message-ID is capped for the index", async () => {
    const { deps, stored } = fakeDeps();
    await ingestInboundBatch([msg(20, { messageId: "<" + "a".repeat(2000) + ">" })], deps, { tenantId: TENANT });
    expect(stored[0].ext!.length).toBeLessThanOrEqual(INBOUND_LIMITS.externalId);
  });

  it("cleanText keeps ordinary text and never ends on half a surrogate pair", () => {
    expect(cleanText("नमस्ते ₹ 😀", 100)).toBe("नमस्ते ₹ 😀");
    const cut = cleanText("ab😀", 3)!;
    expect(cut).toBe("ab");
    expect(cleanText(undefined, 10)).toBeNull();
  });

  it("sanitizeInbound never throws on an invalid date", () => {
    expect(sanitizeInbound(msg(1, { date: new Date(Number.NaN) })).receivedAt).toBeNull();
  });
});
