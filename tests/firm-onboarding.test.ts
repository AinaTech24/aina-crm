/**
 * The post-payment setup wizard (addition C) and the welcome email (D):
 * the gate before and after, re-acceptance of a new version, the NDA's
 * one-time code (wrong / expired / too many), immutable acceptances, PAN and
 * GSTIN validation, and one welcome email — not before onboarding, not twice.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { pendingLegalKinds, legalBlocks } from "@/lib/legal/documents";
import { checkOtp } from "@/lib/onboarding/nda-otp";
import { hashOtpCode } from "@/lib/public-otp";
import { firmDetailsComplete, parseFirmDetails, sniffLogo } from "@/lib/onboarding/wizard";
import { welcomeEmail } from "@/lib/onboarding/welcome";

const mails: Array<{ to: string; cc?: string[]; subject: string; text: string; attachments?: unknown[] }> = [];
const mail = { fail: false };
vi.mock("@/lib/comms/system-email", async (orig) => ({
  ...(await orig<typeof import("@/lib/comms/system-email")>()),
  sendSystemEmail: async (a: { to: string; cc?: string[]; subject: string; text: string; attachments?: unknown[] }) => {
    if (mail.fail) return { sent: false, reason: "send_failed" };
    mails.push(a);
    return { sent: true };
  },
}));

const stored: Array<{ key: string; bytes: number; type: string }> = [];
vi.mock("@/lib/storage/s3", async (orig) => ({
  ...(await orig<typeof import("@/lib/storage/s3")>()),
  putObject: async (key: string, body: Uint8Array, type: string) => {
    stored.push({ key, bytes: body.length, type });
  },
}));

describe("which agreements a firm must accept", () => {
  const cur = [{ kind: "terms" as const, id: "t2" }, { kind: "nda" as const, id: "n1" }];
  it("in setup: everything not yet accepted", () => {
    expect(pendingLegalKinds(cur, [], true)).toEqual(["terms", "nda"]);
    expect(pendingLegalKinds(cur, [{ kind: "terms", documentId: "t2" }], true)).toEqual(["nda"]);
  });
  it("after setup: only a NEWER version of something it accepted", () => {
    expect(pendingLegalKinds(cur, [{ kind: "terms", documentId: "t1" }, { kind: "nda", documentId: "n1" }], false)).toEqual(["terms"]);
    expect(pendingLegalKinds(cur, [{ kind: "terms", documentId: "t2" }, { kind: "nda", documentId: "n1" }], false)).toEqual([]);
  });
  it("a firm never asked (created before the wizard) is not stopped", () => {
    expect(pendingLegalKinds(cur, [], false)).toEqual([]);
  });
  it("renders headings, paragraphs and bullets", () => {
    expect(legalBlocks("Intro\n\n## 1. One\n- a\n- b\nText")).toEqual([
      { type: "p", text: "Intro" },
      { type: "h", text: "1. One" },
      { type: "li", items: ["a", "b"] },
      { type: "p", text: "Text" },
    ]);
  });
});

describe("the NDA one-time code", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  const row = (o: Partial<{ attempts: number; expires: Date }> = {}) => ({
    code_hash: hashOtpCode("123456"),
    expires_at: o.expires ?? new Date(now.getTime() + 5 * 60_000),
    attempts: o.attempts ?? 0,
    verified_at: null,
    created_at: now,
  });
  it("accepts the right code", () => expect(checkOtp(row(), "123456", now)).toEqual({ ok: true }));
  it("refuses a wrong code and says how many tries are left", () => {
    expect(checkOtp(row({ attempts: 1 }), "654321", now)).toMatchObject({ ok: false, reason: "wrong", message: expect.stringContaining("3 tries left") });
  });
  it("refuses an expired code", () => expect(checkOtp(row({ expires: new Date(now.getTime() - 1) }), "123456", now)).toMatchObject({ ok: false, reason: "expired" }));
  it("stops after 5 wrong tries — even the right code", () => expect(checkOtp(row({ attempts: 5 }), "123456", now)).toMatchObject({ ok: false, reason: "too_many" }));
  it("needs a code first", () => expect(checkOtp(null, "123456", now)).toMatchObject({ ok: false, reason: "none" }));
});

describe("firm details", () => {
  const good = {
    legalName: "Mehta Wealth LLP", displayName: "Mehta Wealth", arn: "arn-123456", pan: "aakfm1234c", gstRegistered: true,
    gstin: "", addressLine1: "12 MG Road", city: "Ahmedabad", state: "Gujarat", pincode: "380001", email: "Office@Mehta.in", phone: "98765 43210",
  };
  it("validates the PAN", () => {
    expect(parseFirmDetails({ ...good, gstRegistered: false })).toMatchObject({ ok: true, value: { pan: "AAKFM1234C", arn: "ARN-123456", email: "office@mehta.in", gstin: null } });
    expect(parseFirmDetails({ ...good, gstRegistered: false, pan: "ABCDE1234F" })).toMatchObject({ ok: false, errors: { pan: expect.any(String) } });
  });
  it("validates the GSTIN, its PAN and its state", () => {
    expect(parseFirmDetails({ ...good, gstin: "24ACKFA5449H1ZC" })).toMatchObject({ ok: false, errors: { gstin: expect.stringContaining("check") } });
    expect(parseFirmDetails({ ...good, pan: "ACKFA5449H", gstin: "24ACKFA5449H1ZB" })).toMatchObject({ ok: true, value: { gstin: "24ACKFA5449H1ZB" } });
    expect(parseFirmDetails({ ...good, gstin: "24ACKFA5449H1ZB" })).toMatchObject({ ok: false, errors: { gstin: expect.stringContaining("different PAN") } });
    expect(parseFirmDetails({ ...good, pan: "ACKFA5449H", gstin: "24ACKFA5449H1ZB", state: "Maharashtra" })).toMatchObject({ ok: false, errors: { gstin: expect.stringContaining("Gujarat") } });
  });
  it("lets a firm say it is not GST-registered", () => {
    const r = parseFirmDetails({ ...good, gstRegistered: false, gstin: "junk" });
    expect(r.ok).toBe(true);
  });
  it("knows when the record is complete", () => {
    const t = { legal_name: "X", arn: "ARN-1", pan_number: "AAKFM1234C", address: { line1: "a", pincode: "380001", state: "Gujarat" }, email: "a@b.in", phone: "+919876543210", gst_registered: false, gst_number: null };
    expect(firmDetailsComplete(t)).toBe(true);
    expect(firmDetailsComplete({ ...t, gst_registered: null })).toBe(false);
    expect(firmDetailsComplete({ ...t, gst_registered: true })).toBe(false);
  });
  it("accepts only real images as a logo", () => {
    expect(sniffLogo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffLogo(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("welcome email wording", () => {
  const f = { ownerName: "Asha", firmName: "Mehta Wealth", cycleLabel: "Yearly", users: 5, tierLabel: "Up to ₹500 Cr", nextRenewal: "18 November 2027", nextAmountPaise: 31_594_500, logoMissing: true, ndaEmailedTo: "asha@mehta.in", baseUrl: "https://crm.example" };
  it("says plan, renewal, first steps and the NDA copy", () => {
    const m = welcomeEmail(f);
    expect(m.subject).toContain("Mehta Wealth");
    expect(m.text).toContain("Yearly, 5 users, AUM tier Up to ₹500 Cr");
    expect(m.text).toContain("₹3,15,945 incl. GST");
    expect(m.text).toContain("Add your firm's logo");
    expect(m.text).toContain("NDA was emailed to asha@mehta.in");
    expect(m.html).toContain("https://crm.example/dashboard");
  });
  it("does not ask for a logo the firm already uploaded", () => {
    expect(welcomeEmail({ ...f, logoMissing: false }).text).not.toContain("logo");
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("setup wizard against the database", () => {
  const tenant = randomUUID();
  const owner = randomUUID();
  const email = `owner-${tenant.slice(0, 6)}@example.com`;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let W: typeof import("@/lib/onboarding/wizard");
  let gate: (id: string) => Promise<import("@/lib/legal/documents").OnboardingGate>;
  const actor = () => ({ tenantId: tenant, userId: owner, email, name: "Asha Mehta", ip: "203.0.113.5", userAgent: "vitest" });
  const q = async (t: ReturnType<typeof import("drizzle-orm").sql>) => (await withSystem((tx) => tx.execute(t))).rows as Array<Record<string, any>>;
  const docId = async (kind: string) => (await q(sql`SELECT id FROM legal_documents WHERE kind = ${kind} AND status = 'published' ORDER BY version DESC LIMIT 1`))[0].id as string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    delete process.env.S3_BUCKET;
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    W = await import("@/lib/onboarding/wizard");
    const docs = await import("@/lib/legal/documents");
    gate = (id) => (docs.onboardingGate as unknown as (id: string) => Promise<import("@/lib/legal/documents").OnboardingGate>)(id);
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, onboarding_required) VALUES (${tenant}::uuid, 'Mehta Wealth', 'Mehta Wealth', true)`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status, email_verified_at) VALUES (${owner}::uuid, ${tenant}::uuid, ${email}, 'Asha Mehta', ARRAY['owner']::text[], 'active', now())`);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    await withSystem(async (tx) => {
      await tx.execute(sql`UPDATE tenants SET deleted_at = now() WHERE id = ${tenant}::uuid`);
      // public_email_otps' policy casts app.tenant_id without a platform branch.
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant}, true)`);
      await tx.execute(sql`SELECT platform_purge_tenant(${tenant}::uuid)`);
    }).catch((e) => console.error("cleanup", (e as { cause?: { message?: string } })?.cause?.message ?? e));
  });

  it("before setup the firm is gated; the welcome email does not go", async () => {
    expect(await gate(tenant)).toMatchObject({ mode: "setup", pending: ["terms", "nda"] });
    const { sendWelcomeEmail } = await import("@/lib/onboarding/welcome");
    expect(await sendWelcomeEmail(tenant)).toBe("skipped");
    expect(await W.completeOnboarding(actor())).toMatchObject({ ok: false });
  });

  it("saves firm details", async () => {
    const parsed = W.parseFirmDetails({ legalName: "Mehta Wealth LLP", arn: `ARN-${Math.floor(100000 + Math.random() * 800000)}`, pan: "AAKFM1234C", gstRegistered: false, addressLine1: "12 MG Road", city: "Ahmedabad", state: "Gujarat", pincode: "380001", email, phone: "9876543210" });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(await W.saveFirmDetails(actor(), parsed.value)).toEqual({ ok: true });
  });

  it("records the Terms acceptance with the exact text's hash, and it is immutable", async () => {
    expect(await W.acceptTerms(actor(), await docId("terms"))).toEqual({ ok: true });
    const [a] = await q(sql`SELECT a.text_sha256, d.body_sha256, a.ip_address, a.user_agent FROM legal_acceptances a JOIN legal_documents d ON d.id = a.document_id WHERE a.tenant_id = ${tenant}::uuid AND a.kind = 'terms'`);
    expect(a.text_sha256).toBe(a.body_sha256);
    expect(a).toMatchObject({ ip_address: "203.0.113.5", user_agent: "vitest" });
    await expect(q(sql`UPDATE legal_acceptances SET signer_name = 'Someone else' WHERE tenant_id = ${tenant}::uuid`)).rejects.toThrow();
    await expect(q(sql`DELETE FROM legal_acceptances WHERE tenant_id = ${tenant}::uuid`)).rejects.toThrow();
    // An acceptance that does not quote the published text is refused.
    await expect(q(sql`INSERT INTO legal_acceptances (tenant_id, user_id, document_id, kind, version, text_sha256, signer_name, email)
                       SELECT ${tenant}::uuid, ${owner}::uuid, id, 'terms', version, 'deadbeef', 'X', 'x@y.in' FROM legal_documents WHERE kind = 'terms' AND status = 'published' LIMIT 1`)).rejects.toThrow();
  });

  it("the NDA needs the emailed code: wrong, too many, then a fresh one signs", async () => {
    const nda = await docId("nda");
    const sent = await W.sendNdaCode(actor(), nda);
    expect(sent.ok).toBe(true);
    expect(await W.sendNdaCode(actor(), nda)).toMatchObject({ ok: false, error: expect.stringContaining("wait") });
    const code = /(\d{6})/.exec(mails.at(-1)!.subject)![1];
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await W.signNda(actor(), { documentId: nda, signerName: "Asha Mehta", designation: "Partner", code: wrong, agree: true })).toMatchObject({ ok: false, field: "code" });
    for (let i = 0; i < 4; i++) await W.signNda(actor(), { documentId: nda, signerName: "Asha Mehta", designation: "Partner", code: wrong, agree: true });
    expect(await W.signNda(actor(), { documentId: nda, signerName: "Asha Mehta", designation: "Partner", code, agree: true })).toMatchObject({ ok: false, error: expect.stringContaining("Too many") });
    // A new code (after the resend wait) works.
    const { withTenant } = await import("@/db/client");
    await withTenant(tenant, (tx) => tx.execute(sql`UPDATE public_email_otps SET created_at = now() - interval '2 minutes' WHERE tenant_id = ${tenant}::uuid`));
    expect((await W.sendNdaCode(actor(), nda)).ok).toBe(true);
    const fresh = /(\d{6})/.exec(mails.at(-1)!.subject)![1];
    expect(await W.signNda(actor(), { documentId: nda, signerName: "Asha Mehta", designation: "", code: fresh, agree: true })).toMatchObject({ ok: false, field: "designation" });
    expect(await W.signNda(actor(), { documentId: nda, signerName: "Asha Mehta", designation: "Partner", code: fresh, agree: true })).toEqual({ ok: true });
    const [a] = await q(sql`SELECT otp_verified, designation, signed_pdf_key, compliance_document_id FROM legal_acceptances WHERE tenant_id = ${tenant}::uuid AND kind = 'nda'`);
    expect(a).toMatchObject({ otp_verified: true, designation: "Partner" });
    expect(a.signed_pdf_key).toBeTruthy();
    expect(stored.find((x) => x.key === a.signed_pdf_key)).toMatchObject({ type: "application/pdf" });
    const [doc] = await q(sql`SELECT category, mime_type FROM compliance_documents WHERE id = ${a.compliance_document_id}::uuid`);
    expect(doc).toMatchObject({ category: "other", mime_type: "application/pdf" });
    expect(mails.at(-1)?.attachments).toHaveLength(1);
  });

  it("an expired code is refused", async () => {
    const { checkOtp: chk } = await import("@/lib/onboarding/nda-otp");
    expect(chk({ code_hash: "x", expires_at: new Date(Date.now() - 1000), attempts: 0, verified_at: null, created_at: new Date() }, "123456", new Date()).ok).toBe(false);
  });

  it("finishing onboards the firm once and sends one welcome email; a failed send is retried", async () => {
    mail.fail = true;
    expect(await W.completeOnboarding(actor())).toEqual({ ok: true, first: true });
    let [t] = await q(sql`SELECT onboarded_at, welcome_email_status, welcome_email_sent_at FROM tenants WHERE id = ${tenant}::uuid`);
    expect(t.onboarded_at).toBeTruthy();
    expect(t.welcome_email_status).toBe("failed"); // onboarding is NOT undone
    expect(await gate(tenant)).toMatchObject({ mode: null });
    mail.fail = false;
    const { retryWelcomeEmails, sendWelcomeEmail } = await import("@/lib/onboarding/welcome");
    await retryWelcomeEmails();
    [t] = await q(sql`SELECT welcome_email_status, welcome_email_sent_at FROM tenants WHERE id = ${tenant}::uuid`);
    expect(t.welcome_email_status).toBe("sent");
    const welcomes = () => mails.filter((m) => m.subject.startsWith("Welcome to Aina CRM") && m.to === email);
    expect(welcomes()).toHaveLength(1);
    // Re-running changes nothing.
    expect(await W.completeOnboarding(actor())).toEqual({ ok: true, first: false });
    expect(await sendWelcomeEmail(tenant)).toBe("skipped");
    expect(welcomes()).toHaveLength(1);
  });

  it("a new Terms version must be accepted again at next sign-in (rolled back, so the shared table is untouched)", async () => {
    const { currentDocuments, firmAcceptances, pendingLegalKinds: pending } = await import("@/lib/legal/documents");
    const ROLLBACK = new Error("rollback");
    const seen: Record<string, unknown> = {};
    await withSystem(async (tx) => {
      const id = ((await tx.execute(sql`
        INSERT INTO legal_documents (kind, version, title, body, status)
        SELECT 'terms', max(version) + 1, 'Terms of Service', 'Updated terms for the test — long enough to count as a real document text.', 'published' FROM legal_documents WHERE kind = 'terms'
        RETURNING id
      `)).rows[0] as { id: string }).id;
      const acc = async () => (await firmAcceptances(tx, tenant)).map((a) => ({ kind: a.kind, documentId: a.document_id }));
      seen.before = pending(await currentDocuments(tx), await acc(), false);
      // A published version cannot be edited.
      seen.editRefused = await tx.transaction(async (sp) => sp.execute(sql`UPDATE legal_documents SET body = 'changed' WHERE id = ${id}::uuid`)).then(() => false, () => true);
      const doc = (await currentDocuments(tx)).find((d) => d.kind === "terms")!;
      await tx.execute(sql`INSERT INTO legal_acceptances (tenant_id, user_id, document_id, kind, version, text_sha256, signer_name, email)
                           VALUES (${tenant}::uuid, ${owner}::uuid, ${doc.id}::uuid, 'terms', ${doc.version}, ${doc.bodySha256}, 'Asha Mehta', ${email})`);
      seen.after = pending(await currentDocuments(tx), await acc(), false);
      throw ROLLBACK;
    }).catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
    expect(seen.before).toEqual(["terms"]);
    expect(seen.editRefused).toBe(true);
    expect(seen.after).toEqual([]);
  });
});
