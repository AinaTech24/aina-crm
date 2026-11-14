/**
 * Lead → client journey, end to end on a real database (audit L1, L2, L8, L14,
 * C1, C2, C3, C4, L16, L20). Runs the real route handlers under RLS
 * (TEST_DATABASE_URL); only the session and the licence gate are stubbed.
 *
 * The blocker this pins: after conversion, logging a call, a call outcome or
 * completing / scheduling a meeting on the old lead record must never pull
 * the client's journey back into a lead stage.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const TEST_DB = process.env.TEST_DATABASE_URL;

const state = vi.hoisted(() => ({ session: null as any }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => {
    if (!state.session) throw Object.assign(new Error("unauthorized"), { status: 401 });
    return state.session;
  },
}));
vi.mock("@/lib/auth/license", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/license")>()),
  assertActiveLicense: async () => {},
  assertInvestorQuota: async () => {},
}));

describe.skipIf(!TEST_DB)("lead → client journey (DB)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let convert: typeof import("@/app/api/leads/[id]/convert/route").POST;
  let notes: typeof import("@/app/api/leads/[id]/notes/route").POST;
  let callOutcome: typeof import("@/app/api/leads/[id]/call-outcome/route").POST;
  let advance: typeof import("@/app/api/leads/[id]/blueprint/advance/route").POST;
  let invBlueprint: typeof import("@/app/api/investors/[id]/blueprint/route").GET;
  let autoAdvance: typeof import("@/lib/blueprints/auto-advance").autoAdvance;
  let applyMeetingCompleted: typeof import("@/lib/review-meetings/complete").applyMeetingCompleted;

  const tenant = randomUUID();
  const owner = randomUUID();
  const rm = randomUUID();
  const rm2 = randomUUID();
  const mkt = randomUUID();
  const leadA = randomUUID();
  const leadB = randomUUID();
  const leadC = randomUUID();
  const PAN = "ABCPE" + String(Math.floor(1000 + Math.random() * 8999)) + "K";

  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const one = async <T,>(text: ReturnType<typeof import("drizzle-orm").sql>) => ((await q(text)).rows[0] ?? null) as T | null;
  const sessionFor = (userId: string, roles: string[]) => ({ tenantId: tenant, userId, roles, permissions: null, branchId: null, name: roles[0] });
  const req = (path: string, body?: unknown) =>
    new NextRequest(`https://crm.test${path}`, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const stageOf = async (leadId: string) =>
    (await one<{ k: string }>(sql`SELECT current_stage_key AS k FROM lead_blueprint_instances WHERE lead_id = ${leadId}::uuid`))?.k ?? null;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ POST: convert } = await import("@/app/api/leads/[id]/convert/route"));
    ({ POST: notes } = await import("@/app/api/leads/[id]/notes/route"));
    ({ POST: callOutcome } = await import("@/app/api/leads/[id]/call-outcome/route"));
    ({ POST: advance } = await import("@/app/api/leads/[id]/blueprint/advance/route"));
    ({ GET: invBlueprint } = await import("@/app/api/investors/[id]/blueprint/route"));
    ({ autoAdvance } = await import("@/lib/blueprints/auto-advance"));
    ({ applyMeetingCompleted } = await import("@/lib/review-meetings/complete"));
    const { ensureActiveBlueprint } = await import("@/lib/blueprints/engine");

    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Journey Test', 'Journey Test', ${"ARN-JT-" + tenant.slice(0, 6)})`);
    for (const [id, role] of [[owner, "owner"], [rm, "rm"], [rm2, "rm"], [mkt, "marketing"]] as const) {
      await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status)
                  VALUES (${id}::uuid, ${tenant}::uuid, ${id.slice(0, 8) + "@" + tenant.slice(0, 8) + ".test"}, ${role + "-" + id.slice(0, 4)}, ${`{${role}}`}::text[], 'active')`);
    }
    await withSystem((tx) => ensureActiveBlueprint(tx as any, tenant));
    for (const [id, name, pan, phone, stage] of [
      [leadA, "Asha Lead", PAN, "9811100001", "call_done"],
      [leadB, "Asha Twin", PAN, "9811100002", "won_lead"],
      [leadC, "Bimal Lead", null, "9811100003", "new"],
    ] as const) {
      await q(sql`INSERT INTO leads (id, tenant_id, name, phone, pan, pincode, alt_phone, lead_type, stage, source, owner_id, profile)
                  VALUES (${id}::uuid, ${tenant}::uuid, ${name}, ${phone}, ${pan}, '400001', '9822200000', 'hni', ${stage}, 'manual', ${rm}::uuid,
                          '{"occupation": "Doctor"}'::jsonb)`);
    }
    // Journeys: A at Call Done, B at Won Lead (forced, as the board would).
    const { startJourneyAt } = await import("@/lib/blueprints/journey-access");
    await withSystem((tx) => startJourneyAt(tx as any, tenant, leadA, "call_done"));
    await withSystem((tx) => startJourneyAt(tx as any, tenant, leadB, "won_lead"));
    // A follow-up reminder on lead A, to be cancelled on conversion.
    await q(sql`INSERT INTO tasks (tenant_id, subject_type, subject_id, related_lead_id, type, title, status, assignee_id)
                VALUES (${tenant}::uuid, 'lead', ${leadA}::uuid, ${leadA}::uuid, 'follow_up', 'Call back Asha', 'open', ${rm}::uuid)`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const table of [
      "notifications", "audit_log", "events_outbox", "lead_stage_history", "lead_blueprint_instances", "tasks", "activities",
      "review_meetings", "leads", "investors", "blueprint_transitions", "blueprint_stages", "blueprint_definitions", "users", "branches",
    ]) {
      await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("refuses to convert a lead that is not Won, and a role that cannot create clients (L2)", async () => {
    state.session = sessionFor(rm, ["rm"]);
    const notWon = await convert(req(`/api/leads/${leadA}/convert`, {}), params(leadA));
    expect(notWon.status).toBe(409);
    expect((await notWon.json()).code).toBe("not_won");

    state.session = sessionFor(mkt, ["marketing"]);
    const noCap = await convert(req(`/api/leads/${leadA}/convert`, { confirmWon: true }), params(leadA));
    expect(noCap.status).toBe(403);
    expect(await stageOf(leadA)).toBe("call_done");
  });

  it("converts with the lead's PAN and details, cancels its follow-ups, starts onboarding (L8, L14, L18)", async () => {
    state.session = sessionFor(rm, ["rm"]);
    const res = await convert(req(`/api/leads/${leadA}/convert`, { confirmWon: true }), params(leadA));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.warnings).toEqual([]);
    const inv = await one<any>(sql`SELECT pan, rm_id, segment_tag, occupation, alternate_phone, address FROM investors WHERE id = ${body.investorId}::uuid`);
    expect(inv.pan).toBe(PAN);
    expect(inv.rm_id).toBe(rm);
    expect(inv.segment_tag).toBe("HNI");
    expect(inv.occupation).toBe("Doctor");
    expect(inv.alternate_phone).toBe("9822200000");
    expect(inv.address.pincode).toBe("400001");
    expect(await stageOf(leadA)).toBe("request_documents");
    const fu = await one<{ status: string }>(sql`SELECT status FROM tasks WHERE related_lead_id = ${leadA}::uuid AND type = 'follow_up'`);
    expect(fu?.status).toBe("cancelled");
  });

  it("a call, a call outcome or a meeting on the converted lead never pulls the client back (L1)", async () => {
    state.session = sessionFor(rm, ["rm"]);
    const n = await notes(req(`/api/leads/${leadA}/notes`, { activityType: "call", note: "Spoke after conversion" }), params(leadA));
    expect(n.status).toBe(200);
    expect(await stageOf(leadA)).toBe("request_documents");
    // The call counts as client contact.
    const inv = await one<{ last_contact_at: string | null }>(sql`
      SELECT i.last_contact_at FROM investors i JOIN leads l ON l.converted_investor_id = i.id WHERE l.id = ${leadA}::uuid`);
    expect(inv?.last_contact_at).not.toBeNull();

    for (const outcome of ["not_reachable", "connected", "not_interested"]) {
      const r = await callOutcome(req(`/api/leads/${leadA}/call-outcome`, { outcome }), params(leadA));
      expect(r.status).toBe(201);
      expect(await stageOf(leadA)).toBe("request_documents");
    }
    const lead = await one<{ lost_reason: string | null }>(sql`SELECT lost_reason FROM leads WHERE id = ${leadA}::uuid`);
    expect(lead?.lost_reason).toBeNull();

    // A meeting scheduled and completed on the old lead record.
    const meetingId = randomUUID();
    await q(sql`INSERT INTO review_meetings (id, tenant_id, lead_id, category, meeting_type, meeting_date, meeting_mode, status, rm_id)
                VALUES (${meetingId}::uuid, ${tenant}::uuid, ${leadA}::uuid, 'new', 'discovery_call', now(), 'online', 'scheduled', ${rm}::uuid)`);
    await withTenant(tenant, (tx) => autoAdvance(tx, tenant, leadA, "meeting.scheduled.lead"));
    expect(await stageOf(leadA)).toBe("request_documents");
    await withTenant(tenant, async (tx) => {
      const before = (await tx.execute(sql`SELECT * FROM review_meetings WHERE id = ${meetingId}::uuid`)).rows[0] as any;
      const row = { ...before, id: before.id, leadId: before.lead_id, investorId: before.investor_id, familyId: before.family_id };
      await applyMeetingCompleted(tx, { tenantId: tenant, actorId: rm, before: row, reviewedAt: new Date() });
    });
    expect(await stageOf(leadA)).toBe("request_documents");
    await withTenant(tenant, (tx) => autoAdvance(tx, tenant, leadA, "lead.not_qualified"));
    expect(await stageOf(leadA)).toBe("request_documents");
  });

  it("a converted lead is not forced back to a lead stage by anyone (L10)", async () => {
    state.session = sessionFor(owner, ["owner"]);
    const r = await advance(req(`/api/leads/${leadA}/blueprint/advance`, { toStageKey: "call_done", force: true }), params(leadA));
    expect(r.status).toBe(409);
    expect(await stageOf(leadA)).toBe("request_documents");
  });

  it("an RM cannot force a client onboarding step; KYC Validated needs evidence (L10, C8)", async () => {
    state.session = sessionFor(rm, ["rm"]);
    const forced = await advance(req(`/api/leads/${leadA}/blueprint/advance`, { toStageKey: "ucc_activated", force: true }), params(leadA));
    expect(forced.status).toBe(403);
    state.session = sessionFor(owner, ["owner"]);
    const kyc = await advance(req(`/api/leads/${leadA}/blueprint/advance`, { toStageKey: "kyc_validated", force: true }), params(leadA));
    expect(kyc.status).toBe(409);
    expect(await stageOf(leadA)).toBe("request_documents");
  });

  it("the client's CURRENT RM moves the client phase, not the old lead owner (C4)", async () => {
    await q(sql`UPDATE investors SET rm_id = ${rm2}::uuid WHERE id = (SELECT converted_investor_id FROM leads WHERE id = ${leadA}::uuid)`);
    state.session = sessionFor(rm, ["rm"]);
    const old = await advance(req(`/api/leads/${leadA}/blueprint/advance`, { toStageKey: "documents_pending" }), params(leadA));
    // The firm has no data wall, so the old RM can SEE the client — but no
    // longer edit it.
    expect(old.status).toBe(403);
    state.session = sessionFor(rm2, ["rm"]);
    const cur = await advance(req(`/api/leads/${leadA}/blueprint/advance`, { toStageKey: "documents_pending" }), params(leadA));
    expect(cur.status).toBe(200);
    expect(await stageOf(leadA)).toBe("documents_pending");
  });

  it("converting a second lead with the same PAN answers 409 with the client, never a second record (L8)", async () => {
    state.session = sessionFor(rm, ["rm"]);
    const before = await one<{ c: number }>(sql`SELECT count(*)::int AS c FROM investors WHERE tenant_id = ${tenant}::uuid`);
    const r = await convert(req(`/api/leads/${leadB}/convert`, {}), params(leadB));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.code).toBe("existing_client");
    expect(j.canOverride).toBe(false);
    // No data wall in this firm: the client is visible, so it is named.
    const client = await one<{ id: string }>(sql`SELECT converted_investor_id AS id FROM leads WHERE id = ${leadA}::uuid`);
    expect(j.existing.id).toBe(client?.id);
    expect(j.existing.matchedOn).toContain("pan");
    const after = await one<{ c: number }>(sql`SELECT count(*)::int AS c FROM investors WHERE tenant_id = ${tenant}::uuid`);
    expect(after?.c).toBe(before?.c);
  });

  it("Lost from New with a reason, and reopening clears it (L16, L20)", async () => {
    state.session = sessionFor(rm, ["rm"]);
    const lost = await advance(
      req(`/api/leads/${leadC}/blueprint/advance`, { toStageKey: "not_qualified", fields: { lostReason: "Not interested", lostAt: new Date().toISOString() } }),
      params(leadC),
    );
    expect(lost.status).toBe(200);
    expect(await stageOf(leadC)).toBe("not_qualified");
    const reopened = await advance(req(`/api/leads/${leadC}/blueprint/advance`, { toStageKey: "call_done" }), params(leadC));
    expect(reopened.status).toBe(200);
    const l = await one<{ lost_reason: string | null; lost_at: string | null }>(sql`SELECT lost_reason, lost_at FROM leads WHERE id = ${leadC}::uuid`);
    expect(l?.lost_reason).toBeNull();
    expect(l?.lost_at).toBeNull();
  });

  it("the investor journey API: 404 for a bad id, facts for a direct client (C2)", async () => {
    state.session = sessionFor(owner, ["owner"]);
    const bad = await invBlueprint(req(`/api/investors/not-a-uuid/blueprint`), params("not-a-uuid"));
    expect(bad.status).toBe(404);
    const direct = randomUUID();
    await q(sql`INSERT INTO investors (id, tenant_id, name, status, kyc_status, rm_id) VALUES (${direct}::uuid, ${tenant}::uuid, 'Direct Client', 'active', 'verified', ${rm}::uuid)`);
    const r = await invBlueprint(req(`/api/investors/${direct}/blueprint`), params(direct));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.synthetic).toBe(true);
    const status = Object.fromEntries(j.allStages.map((s: any) => [s.key, s.status]));
    expect(status.kyc_validated).toBe("done");
    expect(status.transaction_successful).not.toBe("done");
    expect(j.allStages.map((s: any) => s.key)).not.toContain("transaction_failed");
  });

  it("an insurance lead converts into insurance onboarding, not MF documents (L6)", async () => {
    const ins = randomUUID();
    await q(sql`INSERT INTO leads (id, tenant_id, name, phone, stage, source, owner_id, pipeline)
                VALUES (${ins}::uuid, ${tenant}::uuid, 'Insa Lead', '9811100009', 'won_lead', 'manual', ${rm}::uuid, 'insurance')`);
    const { startJourneyAt } = await import("@/lib/blueprints/journey-access");
    await withSystem((tx) => startJourneyAt(tx as any, tenant, ins, "won_lead"));
    state.session = sessionFor(rm, ["rm"]);
    const r = await convert(req(`/api/leads/${ins}/convert`, {}), params(ins));
    expect(r.status).toBe(201);
    expect(await stageOf(ins)).toBe("insurance_needs_analysis");
  });

  it("an untouched lead escalates to its owner, the firm owner and only its own branch head (L5, L20)", async () => {
    const branchA = randomUUID();
    const branchB = randomUUID();
    const bhA = randomUUID();
    const bhB = randomUUID();
    for (const b of [branchA, branchB]) {
      await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${b}::uuid, ${tenant}::uuid, ${"B-" + b.slice(0, 4)}, ${"B" + b.slice(0, 4)})`);
    }
    for (const [id, b] of [[bhA, branchA], [bhB, branchB]] as const) {
      await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status, branch_id)
                  VALUES (${id}::uuid, ${tenant}::uuid, ${id.slice(0, 8) + "@bh.test"}, 'BH', '{branch_head}'::text[], 'active', ${b}::uuid)`);
    }
    const cold = randomUUID();
    const gone = randomUUID();
    await q(sql`INSERT INTO leads (id, tenant_id, name, stage, source, owner_id, branch_id, created_at)
                VALUES (${cold}::uuid, ${tenant}::uuid, 'Cold Lead', 'new', 'manual', ${rm}::uuid, ${branchA}::uuid, now() - interval '3 days')`);
    await q(sql`INSERT INTO leads (id, tenant_id, name, stage, source, owner_id, branch_id, created_at, lost_reason)
                VALUES (${gone}::uuid, ${tenant}::uuid, 'Deleted Lead', 'new', 'manual', ${rm}::uuid, ${branchA}::uuid, now() - interval '3 days', '__deleted__')`);
    const { checkBlueprintSLADelays } = await import("@/workers/blueprint-sla-worker");
    await checkBlueprintSLADelays();
    const told = (await q(sql`
      SELECT user_id::text AS u FROM notifications
       WHERE tenant_id = ${tenant}::uuid AND kind = 'blueprint.stage.delayed' AND meta->>'lead_id' = ${cold}
    `)).rows.map((r: any) => r.u).sort();
    expect(told).toEqual([owner, rm, bhA].sort());
    expect(await stageOf(gone)).toBeNull();
  });
});
