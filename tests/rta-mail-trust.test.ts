/**
 * Mail ingestion trust (E7): which inbound RTA mails may route to a firm, which
 * attachments may be imported, and which confirmation links may reach the
 * settings card. Synthetic data only — no real PAN, address or password.
 *
 * Two layers:
 *   • lib/rta/mail-trust — Authentication-Results parsing, the trusted-header
 *     rule, the password proof on real AES / ZipCrypto archives built here;
 *   • the poller's handleMessage with the DB, S3 and queue mocked — the
 *     end-to-end decision (import / quarantine / error) for each case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZipWriter, Uint8ArrayWriter, TextReader } from "@zip.js/zip.js";

const mocks = vi.hoisted(() => ({
  byAlias: vi.fn(),
  bySenders: vi.fn(),
  stamp: vi.fn(),
  confirm: vi.fn(),
  passwords: vi.fn(),
  put: vi.fn(),
  add: vi.fn(),
  execute: vi.fn(),
  inboundLogs: [] as Array<{ outcome: string; reason: string | null; tenantId: string | null }>,
}));

vi.mock("@/db/client", () => {
  const tx = { execute: mocks.execute };
  return {
    withSystem: async (fn: (t: unknown) => unknown) => fn(tx),
    withTenant: async (_t: string, fn: (t: unknown) => unknown) => fn(tx),
  };
});
vi.mock("@/workers/scheduler-state", () => ({ recordRun: vi.fn(async () => {}) }));
vi.mock("@/workers/queues", () => ({ Q: { rtaImport: () => ({ add: mocks.add }) } }));
vi.mock("@/lib/storage/s3", () => ({ putObject: mocks.put }));
vi.mock("@/lib/rta/inbox-config", () => ({ loadRtaInboxConfig: vi.fn() }));
vi.mock("@/lib/observability/capture", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/rta/mailback-download", () => ({ extractRtaDownloadLinks: () => [], fetchRtaDownload: vi.fn() }));
vi.mock("@/lib/rta/mailback-config", () => ({
  resolveTenantByAddresses: mocks.byAlias,
  resolveTenantBySenders: mocks.bySenders,
  stampReceived: mocks.stamp,
  recordForwardingConfirmation: mocks.confirm,
  getMailbackPasswords: vi.fn(async () => ({})),
  passwordsToTry: () => mocks.passwords(),
}));

import { PgDialect } from "drizzle-orm/pg-core";
import {
  attachmentTrust,
  evaluateMailAuth,
  parseAuthResults,
  proveArchiveForFirm,
  safeConfirmationUrl,
} from "@/lib/rta/mail-trust";
import { handleRtaInboundMessage, s3Disposition } from "@/workers/rta-inbox-poller";
import type { InboundRawMessage } from "@/lib/comms/imap";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ALIAS = "rta-0123456789ab@crm.ainatech.in";
const FIRM_PW = "synthetic-firm-pw";
const CSV = "Folio,Scheme,Amount\n1,X,100\n";

const SES_DKIM_CAMS =
  "amazonses.com;\r\n spf=fail (spfCheck: domain does not designate) client-ip=192.0.2.1;\r\n" +
  " dkim=pass header.i=@camsonline.com;\r\n dmarc=pass header.from=camsonline.com;";
const SES_NOTHING = "amazonses.com; spf=none; dkim=none; dmarc=none header.from=example.net;";
const FORGED_CAMS = "amazonses.com; dkim=pass header.d=camsonline.com; dmarc=pass header.from=camsonline.com";

async function zip(name: string, content: string, opts?: { password?: string; zipCrypto?: boolean }) {
  const w = new ZipWriter(
    new Uint8ArrayWriter(),
    opts?.password ? { password: opts.password, zipCrypto: !!opts.zipCrypto, encryptionStrength: 3 } : undefined
  );
  await w.add(name, new TextReader(content));
  return Buffer.from(await w.close());
}

function att(filename: string, content: Buffer) {
  return { filename, contentType: "application/octet-stream", content, size: content.length };
}

function message(over: Partial<InboundRawMessage> = {}): InboundRawMessage {
  return {
    uid: 1,
    messageId: `<synthetic-${Math.random()}@example.test>`,
    from: "donotreply@camsonline.com",
    subject: "WBR2 report",
    text: "",
    recipients: [ALIAS],
    senderCandidates: ["ops@firm.example"],
    attachments: [att("SYNTH_WBR2.csv", Buffer.from(CSV))],
    authResults: [SES_DKIM_CAMS],
    transport: "ses",
    ...over,
  };
}

const aliasRow = { id: "fa-1", tenantId: TENANT, address: ALIAS };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inboundLogs.length = 0;
  mocks.byAlias.mockImplementation(async (_tx: unknown, recipients: string[]) => (recipients.includes(ALIAS) ? aliasRow : null));
  mocks.bySenders.mockResolvedValue({ row: null, ambiguous: false });
  mocks.passwords.mockReturnValue([FIRM_PW]);
  mocks.put.mockResolvedValue(undefined);
  mocks.add.mockResolvedValue({ id: "job" });
  mocks.execute.mockImplementation(async (q: any) => {
    const { sql, params } = new PgDialect().sqlToQuery(q);
    if (sql.includes("INSERT INTO rta_inbound_messages")) {
      // params: tenant_id, forward_address_id, message_id, …, outcome at index 10, reason 11
      mocks.inboundLogs.push({ tenantId: params[0] as string | null, outcome: params[10] as string, reason: params[11] as string | null });
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO rta_file_imports")) return { rows: [{ id: "imp-1" }] };
    return { rows: [] }; // in-flight dedupe: nothing in flight
  });
});
afterEach(() => vi.unstubAllEnvs());

// ── Authentication-Results ──────────────────────────────────────────────────

describe("Authentication-Results parsing", () => {
  it("reads authserv-id, methods and properties, ignoring comments and folding", () => {
    const p = parseAuthResults(SES_DKIM_CAMS)!;
    expect(p.authservId).toBe("amazonses.com");
    expect(p.results.find((r) => r.method === "dkim")).toMatchObject({ result: "pass", props: { "header.i": "@camsonline.com" } });
    expect(p.results.find((r) => r.method === "dmarc")?.props["header.from"]).toBe("camsonline.com");
    expect(p.results.find((r) => r.method === "spf")?.result).toBe("fail");
  });

  it("trusts registrar DKIM only in the TOPMOST header from our own server", () => {
    expect(evaluateMailAuth([SES_DKIM_CAMS], "ses").registrarDomain).toBe("camsonline.com");
    // A forged header BELOW another server's header is never read.
    expect(evaluateMailAuth(["mx.google.com; dkim=pass header.d=gmail.com", FORGED_CAMS], "ses").registrarDomain).toBeNull();
    // Our server's header followed by a second one claiming the same id → forged.
    const twice = evaluateMailAuth([SES_NOTHING, FORGED_CAMS], "ses");
    expect(twice.trustedHeader).toBe(false);
    expect(twice.registrarDomain).toBeNull();
  });

  it("does not count a non-registrar DKIM pass, or a fail", () => {
    expect(evaluateMailAuth(["amazonses.com; dkim=pass header.d=evil-camsonline.com"], "ses").registrarDomain).toBeNull();
    expect(evaluateMailAuth(["amazonses.com; dkim=fail header.d=camsonline.com"], "ses").registrarDomain).toBeNull();
    expect(evaluateMailAuth(["amazonses.com; dkim=pass header.d=mail.kfintech.com"], "ses").registrarDomain).toBe("kfintech.com");
  });

  it("trusts nothing on IMAP until the provider's authserv-id is configured", () => {
    const imapHeader = "mx.mailhost.example; dkim=pass header.d=camsonline.com";
    expect(evaluateMailAuth([imapHeader], "imap").trustedHeader).toBe(false);
    vi.stubEnv("RTA_IMAP_AUTHSERV_ID", "mx.mailhost.example");
    expect(evaluateMailAuth([imapHeader], "imap").registrarDomain).toBe("camsonline.com");
    // The SES id is not trusted for IMAP mail.
    expect(evaluateMailAuth([SES_DKIM_CAMS], "imap").registrarDomain).toBeNull();
  });

  it("authenticates a confirmation only as the provider it is visibly from", () => {
    const g = "amazonses.com; dkim=pass header.d=google.com; dmarc=pass header.from=google.com";
    expect(evaluateMailAuth([g], "ses", "forwarding-noreply@google.com").confirmationDomain).toBe("google.com");
    expect(evaluateMailAuth([g], "ses", "attacker@example.net").confirmationDomain).toBeNull();
    expect(evaluateMailAuth([SES_NOTHING], "ses", "forwarding-noreply@google.com").confirmationDomain).toBeNull();
  });

  it("keeps a confirmation link only when it is https on the provider's host", () => {
    expect(safeConfirmationUrl("https://mail-settings.google.com/mail/vf-%5Babc%5D")).toMatch(/^https:\/\/mail-settings\.google\.com\//);
    expect(safeConfirmationUrl("https://google.com.evil.example/mail/vf-x")).toBeNull();
    expect(safeConfirmationUrl("http://mail.google.com/mail/vf-x")).toBeNull();
    expect(safeConfirmationUrl("javascript:alert(1)")).toBeNull();
    expect(safeConfirmationUrl("https://user:pw@mail.google.com/x")).toBeNull();
  });
});

// ── Password proof ──────────────────────────────────────────────────────────

describe("password proof on archives", () => {
  it("proves an AES archive the firm's saved password opens", async () => {
    expect(await proveArchiveForFirm(await zip("SYNTH_WBR2.csv", CSV, { password: FIRM_PW }), ["other", FIRM_PW])).toEqual({ proven: true });
  });

  it("proves a ZipCrypto archive too", async () => {
    expect((await proveArchiveForFirm(await zip("a.csv", CSV, { password: FIRM_PW, zipCrypto: true }), [FIRM_PW])).proven).toBe(true);
  });

  it("refuses a wrong password, no saved password, and an unencrypted archive", async () => {
    const enc = await zip("a.csv", CSV, { password: "someone-elses" });
    expect((await proveArchiveForFirm(enc, [FIRM_PW])).proven).toBe(false);
    expect((await proveArchiveForFirm(enc, [])).proven).toBe(false);
    const plain = await zip("a.csv", CSV);
    const r = await proveArchiveForFirm(plain, [FIRM_PW]);
    expect(r.proven).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/not password-protected/);
  });

  it("an unencrypted file from unauthenticated mail is quarantined; registrar mail admits it", async () => {
    const unauth = evaluateMailAuth([SES_NOTHING], "ses");
    expect((await attachmentTrust(Buffer.from(CSV), unauth, [FIRM_PW])).admit).toBe(false);
    const cams = evaluateMailAuth([SES_DKIM_CAMS], "ses");
    expect(await attachmentTrust(Buffer.from(CSV), cams, [])).toMatchObject({ admit: true, via: "registrar-auth" });
    const enc = await zip("a.csv", CSV, { password: FIRM_PW });
    // A decrypting archive is NOT sender authentication (owner's decision 2026-10-08):
    // quarantined, with the password result recorded for the reviewer.
    const r = await attachmentTrust(enc, unauth, [FIRM_PW]);
    expect(r.admit).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/does not prove who sent it/);
  });
});

// ── End-to-end decisions in the poller ──────────────────────────────────────

describe("poller decisions", () => {
  it("alias-routed + registrar DKIM pass → imported", async () => {
    const msg = message();
    await handleRtaInboundMessage(msg);
    expect(msg.outcome).toBe("imported");
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.stamp).toHaveBeenCalledTimes(1);
    expect(s3Disposition(msg)).toBe("delete");
  });

  it("header-routed (forwarder/From matches a registered mailbox) → quarantined, nothing stored", async () => {
    mocks.bySenders.mockResolvedValue({ row: aliasRow, ambiguous: false });
    const msg = message({ recipients: ["rta@crm.ainatech.in"] });
    await handleRtaInboundMessage(msg);
    expect(msg.outcome).toBe("quarantined");
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.stamp).not.toHaveBeenCalled();
    // Platform-admin only: the attribution is unverified.
    expect(mocks.inboundLogs.at(-1)).toMatchObject({ outcome: "quarantined", tenantId: null });
    expect(s3Disposition(msg)).toBe("hold");
  });

  it("alias-routed, no Authentication-Results, unencrypted csv → quarantined", async () => {
    const msg = message({ authResults: [] });
    await handleRtaInboundMessage(msg);
    expect(msg.outcome).toBe("quarantined");
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.inboundLogs.at(-1)?.tenantId).toBe(TENANT);
  });

  it("forged registrar header under a non-SES top header → quarantined", async () => {
    const msg = message({ authResults: ["mx.attacker.example; dkim=pass header.d=camsonline.com", FORGED_CAMS] });
    await handleRtaInboundMessage(msg);
    expect(msg.outcome).toBe("quarantined");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("encrypted archive without registrar auth → quarantined even when the saved password opens it", async () => {
    const good = message({ authResults: [SES_NOTHING], attachments: [att("SYNTH_WBR2.zip", await zip("SYNTH_WBR2.csv", CSV, { password: FIRM_PW }))] });
    await handleRtaInboundMessage(good);
    expect(good.outcome).toBe("quarantined");
    expect(mocks.put).not.toHaveBeenCalled();

    mocks.put.mockClear();
    const bad = message({ authResults: [SES_NOTHING], attachments: [att("SYNTH_WBR2.zip", await zip("SYNTH_WBR2.csv", CSV, { password: "not-the-firms" }))] });
    await handleRtaInboundMessage(bad);
    expect(bad.outcome).toBe("quarantined");
    expect(mocks.put).not.toHaveBeenCalled();

    const plainZip = message({ authResults: [SES_NOTHING], attachments: [att("SYNTH_WBR2.zip", await zip("SYNTH_WBR2.csv", CSV))] });
    await handleRtaInboundMessage(plainZip);
    expect(plainZip.outcome).toBe("quarantined");
  });

  it("IMAP mail is not trusted by an amazonses.com header", async () => {
    const msg = message({ transport: "imap" });
    await handleRtaInboundMessage(msg);
    expect(msg.outcome).toBe("quarantined");
  });

  it("a store failure is an ERROR kept for inspection — never 'duplicate'", async () => {
    mocks.put.mockRejectedValue(new Error("S3 unavailable"));
    const msg = message();
    await handleRtaInboundMessage(msg);
    expect(msg.outcome).toBe("error");
    expect(mocks.inboundLogs.at(-1)?.reason).not.toMatch(/Already/);
    expect(s3Disposition(msg)).toBe("park");
  });

  it("one of two files failing keeps the source even though the other imported", async () => {
    mocks.put.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("S3 unavailable"));
    const msg = message({ attachments: [att("SYNTH_WBR2.csv", Buffer.from(CSV)), att("SYNTH2_WBR2.csv", Buffer.from(CSV + "2,Y,1\n"))] });
    await handleRtaInboundMessage(msg);
    expect(msg.outcome).toBe("imported");
    expect(msg.keepSource).toBe(true);
    expect(s3Disposition(msg)).toBe("park");
  });

  it("an unauthenticated confirmation to the alias records its code but never its link", async () => {
    const msg = message({
      from: "forwarding-noreply@google.com",
      subject: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from ops@firm.example",
      text: "ops@firm.example has requested to automatically forward mail. Confirmation code: 123456789 https://evil.example/mail/vf-x",
      attachments: [],
      authResults: [SES_NOTHING],
    });
    await handleRtaInboundMessage(msg);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.anything(), "fa-1", "123456789", null);
  });

  it("an authenticated Google confirmation keeps a Google link", async () => {
    const msg = message({
      from: "forwarding-noreply@google.com",
      subject: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from ops@firm.example",
      text: "Confirmation code: 123456789 https://mail-settings.google.com/mail/vf-%5Bsynthetic%5D",
      attachments: [],
      authResults: ["amazonses.com; dkim=pass header.d=google.com; dmarc=pass header.from=google.com"],
    });
    await handleRtaInboundMessage(msg);
    expect(mocks.confirm.mock.calls[0][3]).toMatch(/^https:\/\/mail-settings\.google\.com\/mail\/vf-/);
  });

  it("an unauthenticated confirmation NOT sent to an alias is quarantined (cannot be claimed later)", async () => {
    mocks.bySenders.mockResolvedValue({ row: aliasRow, ambiguous: false });
    const msg = message({
      recipients: ["rta@crm.ainatech.in"],
      from: "forwarding-noreply@google.com",
      subject: "Gmail Forwarding Confirmation - Receive Mail from ops@firm.example",
      text: "ops@firm.example has requested to automatically forward mail to your email address https://evil.example/mail/vf-x",
      attachments: [],
      authResults: [],
    });
    await handleRtaInboundMessage(msg);
    expect(msg.outcome).toBe("quarantined");
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.stamp).not.toHaveBeenCalled();
  });

  it("S3 dispositions", () => {
    expect(s3Disposition({ outcome: "unroutable" })).toBe("hold");
    expect(s3Disposition({ outcome: "quarantined" })).toBe("hold");
    expect(s3Disposition({ outcome: "error" })).toBe("park");
    expect(s3Disposition({ outcome: "duplicate" })).toBe("delete");
    expect(s3Disposition({ outcome: "imported", keepSource: true })).toBe("park");
  });
});
