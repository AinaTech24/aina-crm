/**
 * The firm's public service request form: a client chooses services, and each
 * one opens its own service request with its own service ID.
 *
 * Pure rules first; then the database behaviour (needs a migrated Postgres in
 * TEST_DATABASE_URL; skipped otherwise). Also the helpers that tell the firm's
 * own automated mail from a person's, used to close the tickets email intake
 * once opened by mistake.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MAX_SERVICES_PER_FORM, WEB_SERVICES, parseServiceSubmission } from "@/lib/service-requests/web-submission";
import { automatedReason, isForwarded } from "@/lib/comms/automated-mail";

const ok = { name: "Asha Mehta", email: "Asha@Example.com", phone: "98765 43210", services: ["statement_request"] };
const parse = (o: Record<string, unknown> = {}) => parseServiceSubmission({ ...ok, ...o });

describe("parseServiceSubmission", () => {
  it("accepts a client with a contact and a service", () => {
    const p = parse();
    expect(p.kind).toBe("ok");
    if (p.kind === "ok") {
      expect(p.value.email).toBe("asha@example.com");
      expect(p.value.phoneLast10).toBe("9876543210");
      expect(p.value.services).toEqual(["statement_request"]);
    }
  });

  it("needs a name, a way to reach the client and at least one service", () => {
    expect(parse({ name: "A" }).kind).toBe("invalid");
    expect(parse({ email: "", phone: "" }).kind).toBe("invalid");
    expect(parse({ services: [] }).kind).toBe("invalid");
    expect(parse({ services: ["not_a_service"] }).kind).toBe("invalid");
  });

  it("checks the email and mobile when given", () => {
    expect(parse({ email: "nope" }).kind).toBe("invalid");
    expect(parse({ phone: "12345" }).kind).toBe("invalid");
  });

  it("keeps each service once, in order, and caps how many", () => {
    const p = parse({ services: ["bank_update", "nominee_update", "bank_update", "bogus"] });
    expect(p.kind === "ok" && p.value.services).toEqual(["bank_update", "nominee_update"]);
    const all = WEB_SERVICES.map((s) => s.value);
    expect(all.length).toBeGreaterThan(MAX_SERVICES_PER_FORM);
    expect(parse({ services: all }).kind).toBe("invalid");
  });

  it("'Other' needs what the client typed, and only then is it kept", () => {
    expect(parse({ services: ["other"] }).kind).toBe("invalid");
    expect(parse({ services: ["other"], otherText: "ab" }).kind).toBe("invalid");
    const p = parse({ services: ["other"], otherText: "  Change   my address " });
    expect(p.kind === "ok" && p.value.otherText).toBe("Change my address");
    expect(parse({ services: ["other", "kyc_update"] }).kind).toBe("invalid");
    // Text typed and then another service chosen instead is dropped.
    const q = parse({ services: ["kyc_update"], otherText: "left over" });
    expect(q.kind === "ok" && q.value.otherText).toBeNull();
  });

  it("PAN and folio are no longer asked", () => {
    const p = parse({ pan: "ABCDE1234F", folio: "123" });
    expect(p.kind === "ok" && "pan" in p.value).toBe(false);
  });

  it("a filled honeypot is a bot", () => {
    expect(parse({ website: "http://spam" }).kind).toBe("trap");
  });
});

describe("the helpers that spot automated mail", () => {
  it("the firm's SIP installment reminder", () => {
    const text =
      "[https://apis.madosx.co.in/Images/SiteLogo/firm.png]\njavascript:void(0)\n\nSIP INSTALLMENT REMINDER\n\nPlease keep sufficient balance in your bank account.";
    expect(automatedReason({ from: "nimesh43299@gmail.com", subject: "Upcoming SIP", text })).not.toBeNull();
  });
  it("no-reply senders and bulk footers; a person's mail is not", () => {
    expect(automatedReason({ from: "noreply@amc.com", subject: "Statement", text: "hi" })).not.toBeNull();
    expect(automatedReason({ from: "a@b.com", subject: "Offers", text: "Click to unsubscribe." })).not.toBeNull();
    expect(automatedReason({ from: "asha@example.com", subject: "Nominee", text: "Please add my son as nominee." })).toBeNull();
  });
  it("forwards", () => {
    expect(isForwarded("Fwd: statement")).toBe(true);
    expect(isForwarded("FW: x")).toBe(true);
    expect(isForwarded("Re: statement")).toBe(false);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("submitWebServiceRequest", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let submit: typeof import("@/lib/service-requests/web-form").submitWebServiceRequest;
  let ensureLink: typeof import("@/lib/service-requests/web-form").ensureServiceFormLink;
  let resolveForm: typeof import("@/lib/service-requests/web-form").resolveServiceForm;
  let replaceToken: typeof import("@/lib/service-requests/web-form").replaceServiceFormToken;
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const rm = randomUUID();
  const owner = randomUUID();
  const ids = { asha: randomUUID(), twinA: randomUUID(), twinB: randomUUID() };

  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const send = (o: Record<string, unknown>) =>
    withSystem((tx) => {
      const p = parseServiceSubmission({ name: "Someone", email: "", phone: "", services: ["statement_request"], ...o });
      if (p.kind !== "ok") throw new Error("test input invalid: " + JSON.stringify(p));
      return submit(tx, tenant, p.value);
    });
  const tickets = async () =>
    (await q(sql`SELECT ticket_no, type, requester_name, investor_id::text AS investor_id, assigned_to_user_id::text AS assignee, channel, status
                   FROM service_requests WHERE tenant_id = ${tenant}::uuid ORDER BY created_at, ticket_no`)).rows as any[];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({
      submitWebServiceRequest: submit,
      ensureServiceFormLink: ensureLink,
      resolveServiceForm: resolveForm,
      replaceServiceFormToken: replaceToken,
    } = await import("@/lib/service-requests/web-form"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Form Test', 'Form Test', ${"ARN-SF-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES
                (${rm}::uuid, ${tenant}::uuid, 'rm@firm.example', 'The RM', ARRAY['rm']::text[], 'active'),
                (${owner}::uuid, ${tenant}::uuid, 'owner@firm.example', 'The Owner', ARRAY['owner']::text[], 'active')`);
    const inv = (id: string, pan: string, name: string, email: string | null, phone: string, rmId: string | null) =>
      q(sql`INSERT INTO investors (id, tenant_id, pan, name, email, phone, rm_id, dedup_pan)
            VALUES (${id}::uuid, ${tenant}::uuid, ${pan}, ${name}, ${email}, ${phone}, ${rmId}, false)`);
    await inv(ids.asha, "AAAAA1111A", "Asha Mehta", "asha@example.com", "+91 98765 43210", rm);
    await inv(ids.twinA, "BBBBB2222B", "Twin One", null, "9000000001", rm);
    await inv(ids.twinB, "CCCCC3333C", "Twin Two", null, "9000000001", rm);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["notifications", "communications", "events_outbox", "service_requests", "users", "investors"]) {
      await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("each service chosen opens its own request with its own service ID, linked to the client and their RM", async () => {
    const r = await send({ name: "Asha Mehta", email: "ASHA@example.com", services: ["bank_update", "nominee_update"], details: "New HDFC account" });
    expect(r).toHaveLength(2);
    expect(new Set(r.map((x) => x.ticketNo)).size).toBe(2);
    expect(r.every((x) => /^SR-\d{4}-\d{5}$/.test(x.ticketNo) && !x.alreadyOpen)).toBe(true);
    const t = await tickets();
    expect(t).toHaveLength(2);
    expect(t.map((x) => x.type).sort()).toEqual(["bank_update", "nominee_update"]);
    expect(t.every((x) => x.investor_id === ids.asha && x.assignee === rm && x.channel === "form" && x.status === "open")).toBe(true);
  }, 60_000);

  it("the same client sending the same request again gets the same service ID, not a second ticket", async () => {
    const before = await tickets();
    const r = await send({ name: "Asha Mehta", phone: "9876543210", services: ["bank_update"] });
    expect(r[0].alreadyOpen).toBe(true);
    expect(before.map((x) => x.ticket_no)).toContain(r[0].ticketNo);
    expect(await tickets()).toHaveLength(before.length);
  }, 60_000);

  it("someone the firm does not know is not linked to any client", async () => {
    const r = await send({ name: "Stranger", email: "who@nowhere.example", services: ["statement_request"] });
    expect(r).toHaveLength(1);
    const row = (await tickets()).find((x) => x.ticket_no === r[0].ticketNo)!;
    expect(row.investor_id).toBeNull();
    expect(row.assignee).toBeNull();
    // The list can still name the person, who is not a client record.
    expect(row.requester_name).toBe("Stranger");
  }, 60_000);

  it("'Other' carries what the client typed into the ticket", async () => {
    const r = await send({ name: "Stranger Two", email: "two@nowhere.example", services: ["other"], otherText: "Change my address", details: "I moved to Pune" });
    const row = (await q(sql`SELECT subject, description FROM service_requests WHERE ticket_no = ${r[0].ticketNo} AND tenant_id = ${tenant}::uuid`)).rows[0] as any;
    expect(row.subject).toContain("Other: Change my address");
    expect(row.description).toContain("Request: Change my address");
    expect(row.description).toContain("I moved to Pune");
  }, 60_000);

  it("a mobile shared by two clients links to neither", async () => {
    const r = await send({ name: "Twin", phone: "9000000001", services: ["kyc_update"] });
    const row = (await tickets()).find((x) => x.ticket_no === r[0].ticketNo)!;
    expect(row.investor_id).toBeNull();
  }, 60_000);

  it("the firm's link is made once and the old link dies when replaced", async () => {
    const a = await withSystem((tx) => ensureLink(tx, tenant));
    const b = await withSystem((tx) => ensureLink(tx, tenant));
    expect(b.token).toBe(a.token);
    expect((await resolveForm(a.token))?.tenantId).toBe(tenant);
    const fresh = await withSystem((tx) => replaceToken(tx, tenant));
    expect(await resolveForm(a.token)).toBeNull();
    expect((await resolveForm(fresh))?.enabled).toBe(true);
  }, 60_000);
});
