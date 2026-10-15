/**
 * G-1 incomplete minor onboarding (2026-10-15). A typed guardian PAN that
 * links nobody still saves the minor; this pins what follows:
 *
 *   1. the save says so (guardianNotice) and the record says "Guardian not
 *      verified" (status derived from the audit trail — no new table);
 *   2. an MF proposal cannot proceed: the journey's proposal gate and the
 *      send route both refuse, even with the minor's own current assessment;
 *   3. retrying the same minor makes no second record, and the refusal names
 *      nobody;
 *   4. only linking the guardian's client record resolves it (there is no
 *      "confirm by note": owner decision 2026-10-15);
 *   5. no answer carries the guardian's name, PAN or risk.
 *
 * Real PostgreSQL (RLS on, restricted app role), real route handlers.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { guardianVerificationFrom } from "@/lib/investors/guardian-verification";

const TEST_DB = process.env.TEST_DATABASE_URL;
const h = vi.hoisted(() => ({ session: null as any }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => h.session) }));
vi.mock("@/lib/auth/license", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/license")>()),
  assertActiveLicense: vi.fn(async () => {}),
  assertInvestorQuota: vi.fn(async () => {}),
  assertModuleEnabled: vi.fn(async () => {}),
}));

const L = "ABCDEFGHJKLMNQRSTUVWXYZ";
const r = (n: number) => Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join("");
const pan = (type = "P") => `${r(3)}${type}${r(1)}${String(1000 + Math.floor(Math.random() * 8999))}${r(1)}`;

describe("guardian verification status (pure)", () => {
  it("decides from the link, then the latest guardian event", () => {
    const minor = { isMinor: true, guardianInvestorId: null };
    expect(guardianVerificationFrom({ isMinor: false, guardianInvestorId: null }, "investor.guardian_not_linked")).toBe("not_applicable");
    expect(guardianVerificationFrom({ isMinor: true, guardianInvestorId: "g" }, "investor.guardian_not_linked")).toBe("linked");
    expect(guardianVerificationFrom(minor, "investor.guardian_not_linked")).toBe("pending");
    expect(guardianVerificationFrom(minor, "investor.guardian_unlinked")).toBe("pending");
    expect(guardianVerificationFrom(minor, "investor.guardian_linked")).toBe("pending"); // the link is gone
    expect(guardianVerificationFrom(minor, "investor.guardian_verified")).toBe("not_recorded"); // no such state
    expect(guardianVerificationFrom(minor, null)).toBe("not_recorded");
  });
});

describe.skipIf(!TEST_DB)("G-1 — incomplete minor onboarding (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let G: typeof import("@/lib/investors/guardian-link");
  let V: typeof import("@/lib/investors/guardian-verification");
  const t = randomUUID();
  const owner = randomUUID(), compliance = randomUUID(), rmA = randomUUID(), rmB = randomUUID();
  const gA = randomUUID(), gB = randomUUID();
  const PA = pan(), PB = pan();
  const SECRET = "very_aggressive";
  const sess = (userId: string, roles: string[]) => ({ userId, tenantId: t, roles, permissions: [], branchId: null, sid: "s" });
  const one = async (q: any) => withTenant(t, async (tx) => (await tx.execute(q)).rows[0] as any);
  const req = (method: string, url: string, body?: any) =>
    new NextRequest(`http://x${url}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const json = async (res: Response) => { const text = await res.text(); return { status: res.status, text, body: text ? JSON.parse(text) : null }; };
  const post = async (body: any) => json(await (await import("@/app/api/investors/route")).POST(req("POST", "/api/investors", body)));
  const patch = async (id: string, body: any) =>
    json(await (await import("@/app/api/investors/[id]/route")).PATCH(req("PATCH", `/api/investors/${id}`, body), { params: Promise.resolve({ id }) }));
  const gv = async (id: string, method: "GET") => {
    const m = await import("@/app/api/investors/[id]/guardian-verification/route");
    return json(await (m as any)[method](req(method, `/api/investors/${id}/guardian-verification`), { params: Promise.resolve({ id }) }));
  };
  const send = async (id: string) => {
    const m = await import("@/app/api/proposals/[id]/send/route");
    return json(await m.POST(req("POST", `/api/proposals/${id}/send`, { channel: "link", preview: true }), { params: Promise.resolve({ id }) }));
  };
  const status = (id: string) => withTenant(t, (tx) => V.guardianVerification(tx, t, id));
  const proposalGate = async (id: string, target = "proposal") => {
    const J = await import("@/lib/opportunities/journey");
    const opp = { id: randomUUID(), tenantId: t, investorId: id, product: "mutual_funds", pipeline: "mf", status: "open", createdAt: new Date() } as any;
    const f = await withTenant(t, (tx) => J.loadFacts(tx as any, opp));
    return J.gateFor(target, opp, f);
  };
  const ownAssessment = (id: string) => withTenant(t, (tx) => tx.execute(sql`
    INSERT INTO risk_profile_responses (tenant_id, investor_id, final_category, total_score, signed_at, provisional)
    VALUES (${t}::uuid, ${id}::uuid, 'moderate', 11, now() - interval '1 day', false)`));
  const mfProposal = async (investorId: string, by: string) => {
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO proposals (id, tenant_id, proposal_number, recipient_type, recipient_name, title, investor_id, prepared_by_user_id, products, suitability_note, status)
      VALUES (${id}::uuid, ${t}::uuid, ${"P-" + id.slice(0, 8)}, 'investor', 'Kid', 'MF plan', ${investorId}::uuid, ${by}::uuid,
              ${JSON.stringify([{ kind: "mf", schemeName: "Liquid Fund", riskRating: "low" }])}::jsonb, 'Liquid, low risk.', 'draft')`));
    return id;
  };
  const minorBody = (gpan: string, name: string) => ({
    name, investorCategory: "minor", dob: "2015-05-05", segmentTag: "Retail",
    typeDetails: { guardian: { name: "Typed Guardian", pan: gpan, relation: "father" } },
  });
  const leaks = (text: string) => {
    expect(text).not.toContain("Parent Other Book");
    expect(text).not.toContain(PB);
    expect(text).not.toContain(SECRET);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    G = await import("@/lib/investors/guardian-link");
    V = await import("@/lib/investors/guardian-verification");
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn, restrict_user_data_scope) VALUES (${t}::uuid, 'G1v firm', 'G1v firm', ${"ARN-GV" + t.slice(0, 5)}, true)`);
      for (const [id, role, nm] of [[owner, "owner", "Owner"], [compliance, "compliance", "Comp"], [rmA, "rm", "RMA"], [rmB, "rm", "RMB"]] as const) {
        await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${id}::uuid, ${t}::uuid, ${`${nm}-${id.slice(0, 8)}@example.test`}, ${nm}, ARRAY[${role}]::text[], 'active')`);
      }
    });
    await withTenant(t, async (tx) => {
      for (const [id, p, name, rm, risk] of [[gA, PA, "Parent In Book", rmA, "moderate"], [gB, PB, "Parent Other Book", rmB, SECRET]] as const) {
        await tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, dob, risk_profile, risk_profile_score, risk_profile_signed_at, risk_profile_provisional, status, dedup_pan)
          VALUES (${id}::uuid, ${t}::uuid, ${p}, ${name}, ${rm}::uuid, 'individual', '1980-01-01', ${risk}, 77, now() - interval '20 days', false, 'active', true)`);
      }
    });
  });

  afterAll(async () => {
    const tryRun = async (q: any) => { try { await withSystem((tx) => tx.execute(q)); } catch { /* best effort */ } };
    for (const table of ["proposals", "risk_profile_responses", "events_outbox", "audit_log", "idempotency_keys", "investors", "users"]) await tryRun(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`));
    await tryRun(sql`DELETE FROM tenants WHERE id = ${t}::uuid`);
  });

  it("a refused typed PAN: warned, pending, MF proposal blocked at the journey gate and the send route — even with the minor's own current assessment", async () => {
    h.session = sess(rmA, ["rm"]);
    const res = await post(minorBody(PB, "Kid Pending One"));
    expect(res.status).toBe(201);
    expect(res.body.guardianLinked).toBe(false);
    expect(res.body.guardianNotice).toBe(G.GUARDIAN_PAN_NOT_LINKED);
    expect(res.body.guardianNotice).toMatch(/NOT VERIFIED/);
    leaks(res.text);
    const kid = res.body.id;
    expect(await status(kid)).toBe("pending");
    const g = await gv(kid, "GET");
    expect(g.body).toEqual({ status: "pending", label: "Guardian not verified" });

    await ownAssessment(kid); // the minor's OWN current assessment is not enough
    const gate = await proposalGate(kid);
    expect(gate.find((p) => /guardian/i.test(p.label))?.satisfied).toBe(false);
    expect(gate.find((p) => /risk profile/i.test(p.label))?.satisfied).toBe(true);
    expect((await proposalGate(kid, "mf_transaction")).find((p) => /guardian/i.test(p.label))?.satisfied).toBe(false);

    const prop = await mfProposal(kid, rmA);
    const s = await send(prop);
    expect(s.status).toBe(412);
    expect(s.body.field).toBe("guardian");
    expect(s.body.error).toBe(V.GUARDIAN_PENDING_MESSAGE);
    leaks(s.text);
  });

  it("retrying the same minor makes no second record and the refusal names nobody", async () => {
    h.session = sess(rmA, ["rm"]);
    const first = await post(minorBody(PB, "Kid Retry"));
    expect(first.status).toBe(201);
    for (let i = 0; i < 2; i++) {
      const again = await post(minorBody(PB, "Kid Retry"));
      expect(again.status).toBe(409);
      expect(again.body.error).toBe("A client with these details is already on record. Search the client list before adding them again.");
      leaks(again.text);
      expect(again.text).not.toMatch(/PAN/);
    }
    const n = await one(sql`SELECT count(*)::int AS n FROM investors WHERE tenant_id = ${t}::uuid AND name = 'Kid Retry'`);
    expect(n.n).toBe(1);
    // Exactly one refusal on record for the one minor — the failed retries left nothing.
    const a = await one(sql`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = ${t}::uuid AND entity_id = ${first.body.id}::uuid AND action = 'investor.guardian_not_linked'`);
    expect(a.n).toBe(1);
  });

  it("linking the guardian's client record resolves it; an RM outside the book gets 404, not the status", async () => {
    h.session = sess(rmA, ["rm"]);
    const kid = (await post(minorBody(PB, "Kid Link Later"))).body.id;
    expect(await status(kid)).toBe("pending");
    const linked = await patch(kid, { typeDetails: { guardian: { name: "Parent In Book", pan: PA, relation: "father" } } });
    expect(linked.status).toBe(200);
    expect(await status(kid)).toBe("linked");
    h.session = sess(rmB, ["rm"]);
    const other = await gv(kid, "GET");
    expect(other.status).toBe(404);
    expect(other.text).not.toContain("linked");
  });

  it("an adult or a minor saved with no guardian event is not blocked by this rule (reported as not_recorded)", async () => {
    expect(await status(gA)).toBe("not_applicable");
    const id = randomUUID();
    await withTenant(t, (tx) => tx.execute(sql`INSERT INTO investors (id, tenant_id, pan, name, rm_id, investor_category, is_minor, dob, status)
      VALUES (${id}::uuid, ${t}::uuid, ${"MINOR:" + pan()}, 'Old Kid', ${rmA}::uuid, 'minor', true, '2014-01-01', 'active')`));
    expect(await status(id)).toBe("not_recorded");
    await ownAssessment(id);
    expect((await proposalGate(id)).every((p) => p.satisfied)).toBe(true);
  });
});
