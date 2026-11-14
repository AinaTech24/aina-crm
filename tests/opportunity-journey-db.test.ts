/**
 * The opportunity journey against a real database (lib/opportunities): the
 * evidence each step accepts, who may approve, what a close writes back.
 * Needs a migrated Postgres in TEST_DATABASE_URL; skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clientOpportunities } from "@/db/schema";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("opportunity journey (DB)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let J: typeof import("@/lib/opportunities/journey");
  let S: typeof import("@/lib/opportunities/steps");
  let L: typeof import("@/lib/opportunities/later");
  let poly: typeof import("@/lib/blueprints/poly-engine");

  const tenant = randomUUID();
  const branch = randomUUID();
  const u = { owner: randomUUID(), head: randomUUID(), rm: randomUUID(), ops: randomUUID(), boss: randomUUID() };
  const actor = (userId: string) => ({ tenantId: tenant, userId });
  const tx = <T,>(fn: (t: any) => Promise<T>) => withSystem(fn);
  const q = (text: any) => withSystem((t) => t.execute(text));
  const one = async (text: any) => ((await q(text)).rows[0] as any);
  let n = 0;

  async function client(extra: Record<string, unknown> = {}) {
    const id = randomUUID();
    n++;
    await q(sql`INSERT INTO investors (id, tenant_id, pan, name, dedup_pan, rm_id, branch_id, kyc_status, bse_ucc_code, mandate_status, risk_profile_signed_at, cross_sell)
                VALUES (${id}::uuid, ${tenant}::uuid, ${`ABCDE${String(1000 + n)}F`}, ${`Client ${n}`}, false, ${u.rm}::uuid, ${branch}::uuid,
                        'verified', ${"UCC" + n}, 'active', now() - interval '10 days', ${JSON.stringify(extra.crossSell ?? {})}::jsonb)`);
    return id;
  }
  const open = (investorId: string, product: string, extra: Record<string, unknown> = {}) =>
    tx((t) => J.createOpportunity(t, actor(u.rm), { investorId, product, ...extra } as any)).then((r) => r.opportunity);
  const stage = async (id: string) =>
    (await one(sql`SELECT current_stage_key AS k FROM blueprint_instances WHERE subject_type = 'opportunity' AND subject_id = ${id}::uuid`)).k as string;
  const row = (id: string) => one(sql`SELECT * FROM client_opportunities WHERE id = ${id}::uuid`);
  const oppOf = async (t: any, id: string) => (await t.select().from(clientOpportunities).where(eq(clientOpportunities.id, id)))[0];
  const facts = (id: string) => tx(async (t) => J.loadFacts(t, await oppOf(t, id)));
  const jump = (id: string, to: string) => tx((t) => poly.transitionPoly(t, tenant, "opportunity", id, to, { systemBypass: true, finalStatus: "in_progress" }));
  const backdate = (id: string) => q(sql`UPDATE client_opportunities SET created_at = now() - interval '3 days' WHERE id = ${id}::uuid`);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    J = await import("@/lib/opportunities/journey");
    S = await import("@/lib/opportunities/steps");
    L = await import("@/lib/opportunities/later");
    poly = await import("@/lib/blueprints/poly-engine");
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Opp Journey', 'Opp Journey', ${"ARN-OJ-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branch}::uuid, ${tenant}::uuid, 'HQ', 'HQ')`);
    const user = (id: string, name: string, roles: string[], manager: string | null = null) =>
      q(sql`INSERT INTO users (id, tenant_id, email, name, roles, branch_id, reporting_manager_id, status)
            VALUES (${id}::uuid, ${tenant}::uuid, ${name.toLowerCase().replace(/ /g, ".") + "@" + tenant.slice(0, 8) + ".test"}, ${name},
                    ${`{${roles.join(",")}}`}::text[], ${branch}::uuid, ${manager}::uuid, 'active')`);
    await user(u.owner, "Olga Owner", ["owner"]);
    await user(u.boss, "Bina Boss", ["branch_head"]);
    await user(u.head, "Hari Head", ["branch_head"], u.boss);
    await user(u.rm, "Ravi Rm", ["rm"], u.head);
    await user(u.ops, "Oma Ops", ["back_office"]);
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["notifications", "audit_log", "events_outbox", "blueprint_stage_history", "blueprint_instances", "tasks",
      "client_opportunities", "proposals", "transactions", "sips", "insurance_policies", "fixed_deposits", "expected_inflows",
      "blueprint_transitions", "blueprint_stages", "blueprints", "investors", "users", "branches"]) {
      await q(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${tenant}'`)).catch(() => {});
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("O1: an NPS opportunity with no CRM proposal reaches Executed → Won on the RM's recorded acceptance", async () => {
    const c = await client();
    const o = await open(c, "nps");
    await tx((t) => S.runStepAction(t, actor(u.rm), o.id, { action: "log_call", outcome: "spoke" }));
    await tx((t) => S.runStepAction(t, actor(u.rm), o.id, { action: "meeting_done" }));
    expect(await stage(o.id)).toBe("proposal");
    await tx((t) => S.runStepAction(t, actor(u.rm), o.id, { action: "quote_shared" }));
    expect(await stage(o.id)).toBe("accepted");
    // The gate names the action that clears it.
    const [view] = await tx((t) => J.listOpportunities(t, tenant, { ids: [o.id] }));
    expect(view.gate.find((g) => !g.satisfied)?.byAction).toBe("record_acceptance");
    const noHow = await tx((t) => S.runStepAction(t, actor(u.rm), o.id, { action: "record_acceptance" }));
    expect(noHow.ok).toBe(false);
    const r = await tx((t) => S.runStepAction(t, actor(u.rm), o.id, { action: "record_acceptance", how: "phone" }));
    expect(r.ok).toBe(true);
    expect(await stage(o.id)).toBe("gen_executed");
    const audit = await one(sql`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${o.id}::uuid AND action = 'opportunity.acceptance_recorded'`);
    expect(audit.n).toBe(1);
    const won = await tx((t) => S.runStepAction(t, actor(u.rm), o.id, { action: "executed" }));
    expect(won.ok && won.stage).toBe("won");
    expect((await row(o.id)).status).toBe("won");
    const cs = await one(sql`SELECT cross_sell ->> 'nps' AS s FROM investors WHERE id = ${c}::uuid`);
    expect(cs.s).toBe("held_with_us");
    // O15: its open follow-ups were cancelled, not completed.
    const done = await one(sql`SELECT count(*) FILTER (WHERE status = 'completed')::int AS c FROM tasks WHERE meta ->> 'opportunityId' = ${o.id}`);
    expect(done.c).toBe(0);
  });

  it("O1: a pending CRM proposal is approved there — the RM cannot record over it", async () => {
    const c = await client();
    const o = await open(c, "pms");
    await jump(o.id, "accepted");
    await q(sql`INSERT INTO proposals (tenant_id, investor_id, opportunity_id, title, proposal_number, recipient_type, recipient_name, type, status)
                VALUES (${tenant}::uuid, ${c}::uuid, ${o.id}::uuid, 'PMS', ${"P-" + o.id.slice(0, 6)}, 'investor', 'X', 'pms', 'sent')`);
    const r = await tx((t) => S.runStepAction(t, actor(u.rm), o.id, { action: "record_acceptance", how: "email" }));
    expect(r.ok).toBe(false);
  });

  it("O2: an instalment of a SIP registered before is not the new SIP; a new registration or the recorded order is", async () => {
    const c = await client();
    await q(sql`INSERT INTO sips (tenant_id, investor_id, scheme_code, scheme_name, amount, status, created_at)
                VALUES (${tenant}::uuid, ${c}::uuid, 'S1', 'Old Fund', 5000, 'active', now() - interval '1 year')`);
    const o = await open(c, "mutual_funds", { investmentMode: "sip", expectedValue: 5000 });
    await backdate(o.id);
    await q(sql`INSERT INTO transactions (tenant_id, investor_id, scheme_code, scheme_name, type, direction, amount, status, order_date)
                VALUES (${tenant}::uuid, ${c}::uuid, 'S1', 'Old Fund', 'sip', 'inflow', 5000, 'completed', (now() AT TIME ZONE 'Asia/Kolkata')::date)`);
    expect((await facts(o.id)).transaction).toBeNull();
    // A debit of a scheme with no SIP before: a new SIP.
    await q(sql`INSERT INTO transactions (tenant_id, investor_id, scheme_code, scheme_name, type, direction, amount, status, order_date)
                VALUES (${tenant}::uuid, ${c}::uuid, 'S2', 'New Fund', 'sip', 'inflow', 5000, 'completed', (now() AT TIME ZONE 'Asia/Kolkata')::date)`);
    expect((await facts(o.id)).transaction?.kind).toBe("new_sip");
    // The order recorded at "Order placed" wins over anything else.
    await q(sql`UPDATE client_opportunities SET step_details = step_details || '{"mf_transaction":{"orderNo":"ord-77"}}'::jsonb WHERE id = ${o.id}::uuid`);
    await q(sql`INSERT INTO transactions (tenant_id, investor_id, scheme_code, type, direction, amount, status, order_id, order_date)
                VALUES (${tenant}::uuid, ${c}::uuid, 'S3', 'sip', 'inflow', 5000, 'completed', 'ORD-77', (now() AT TIME ZONE 'Asia/Kolkata')::date)`);
    expect((await facts(o.id)).transaction?.kind).toBe("order");
  });

  it("O3 + O5: only a policy of the opportunity's line counts, and an in-force one wins it", async () => {
    const c = await client();
    const o = await open(c, "health_insurance");
    await backdate(o.id);
    const pol = (type: string, status = "active") => tx(async (t) => {
      const id = randomUUID();
      await t.execute(sql`INSERT INTO insurance_policies (id, tenant_id, investor_id, insurer, plan_name, policy_type, status)
                          VALUES (${id}::uuid, ${tenant}::uuid, ${c}::uuid, 'Ins Co', 'Plan', ${type}, ${status})`);
      return J.onPolicyRecorded(t, actor(u.rm), { id, investorId: c, policyType: type, status, createdAt: new Date(), planName: "Plan", insurer: "Ins Co" });
    });
    expect(await pol("motor")).toBeNull();
    expect((await facts(o.id)).policy).toBeNull();
    expect((await row(o.id)).status).toBe("open");
    expect(await pol("health")).toBe(o.id);
    expect((await row(o.id)).status).toBe("won");
  });

  it("O6: an unlinked mixed proposal with two candidate opportunities answers neither", async () => {
    const c = await client();
    const a = await open(c, "mutual_funds");
    const b = await open(c, "life_insurance");
    await jump(a.id, "proposal");
    await jump(b.id, "proposal");
    const pid = randomUUID();
    await q(sql`INSERT INTO proposals (id, tenant_id, investor_id, title, proposal_number, recipient_type, recipient_name, type, status)
                VALUES (${pid}::uuid, ${tenant}::uuid, ${c}::uuid, 'Mixed', ${"M-" + pid.slice(0, 6)}, 'investor', 'X', 'mixed', 'sent')`);
    expect((await facts(a.id)).proposal).toBeNull();
    expect(await tx((t) => J.onProposalEvent(t, tenant, pid, "sent", u.rm))).toBeNull();
    expect(await stage(a.id)).toBe("proposal");
    expect(await stage(b.id)).toBe("proposal");
  });

  it("O14: a declined proposal takes the journey back to Proposal", async () => {
    const c = await client();
    const o = await open(c, "pms");
    await jump(o.id, "accepted");
    const pid = randomUUID();
    await q(sql`INSERT INTO proposals (id, tenant_id, investor_id, opportunity_id, title, proposal_number, recipient_type, recipient_name, type, status)
                VALUES (${pid}::uuid, ${tenant}::uuid, ${c}::uuid, ${o.id}::uuid, 'PMS', ${"D-" + pid.slice(0, 6)}, 'investor', 'X', 'pms', 'rejected')`);
    await tx((t) => J.onProposalEvent(t, tenant, pid, "declined", u.rm));
    expect(await stage(o.id)).toBe("proposal");
  });

  it("O10 + O4 + O15: operations — never the owner — approves and does the RTA check, which wins it", async () => {
    const c = await client();
    const o = await open(c, "mutual_funds", { investmentMode: "lumpsum" });
    await jump(o.id, "txn_review");
    const byOwner = await tx((t) => J.decideTransaction(t, actor(u.rm), o.id, { decision: "approve" }));
    expect(byOwner.ok).toBe(false);
    const toOwner = await tx((t) => J.decideTransaction(t, actor(u.ops), o.id, { decision: "approve", assigneeId: u.rm }));
    expect(toOwner.ok).toBe(false);
    const ok = await tx((t) => J.decideTransaction(t, actor(u.ops), o.id, { decision: "approve" }));
    expect(ok).toEqual({ ok: true, stage: "rta_check" });
    const task = await one(sql`SELECT id, assignee_id::text AS a, due_at, meta FROM tasks WHERE meta ->> 'opportunityId' = ${o.id} AND meta ->> 'rtaCheck' = 'true'`);
    expect(task.a).toBe(u.ops);
    // Change follow-up never moves operations' RTA check.
    await tx(async (t) => J.setFollowUp(t, actor(u.rm), await oppOf(t, o.id), "2030-01-01"));
    const after = await one(sql`SELECT due_at FROM tasks WHERE id = ${task.id}::uuid`);
    expect(new Date(after.due_at).getTime()).toBe(new Date(task.due_at).getTime());
    // The owner cannot complete it.
    await q(sql`UPDATE tasks SET status = 'completed' WHERE id = ${task.id}::uuid`);
    await expect(tx((t) => J.onOpportunityTaskCompleted(t, { ...actor(u.rm), roles: ["rm"] }, task))).rejects.toThrow(/operations/);
    await tx((t) => J.onOpportunityTaskCompleted(t, { ...actor(u.ops), roles: ["back_office"] }, task));
    expect((await row(o.id)).status).toBe("won");
  });

  it("O9: a supervisor moves a journey back a step and reopens a closed one", async () => {
    const c = await client();
    const o = await open(c, "loan");
    await jump(o.id, "accepted");
    await q(sql`UPDATE client_opportunities SET step_details = step_details || '{"accepted":{"action":"record_acceptance","how":"phone"}}'::jsonb WHERE id = ${o.id}::uuid`);
    const back = await tx((t) => J.moveOpportunityBack(t, actor(u.head), o.id, "marked by mistake"));
    expect(back.ok && back.stage).toBe("proposal");
    expect((await row(o.id)).step_details.accepted).toBeUndefined();
    await tx((t) => J.advanceOpportunity(t, actor(u.rm), o.id, { to: "lost", lostReason: "Not now" }));
    expect((await row(o.id)).status).toBe("lost");
    const re = await tx((t) => J.reopenOpportunity(t, actor(u.head), o.id, "client called back"));
    expect(re.ok && re.stage).toBe("proposal");
    expect((await row(o.id)).status).toBe("open");
    const audits = await one(sql`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${o.id}::uuid AND action IN ('opportunity.moved_back', 'opportunity.reopened')`);
    expect(audits.n).toBe(2);
  });

  it("O8 + O17: a loss writes back the card's earlier status, and a revisit date must be in the future", async () => {
    const c = await client({ crossSell: { loan: "held_elsewhere" } });
    const o = await open(c, "loan");
    expect((await one(sql`SELECT cross_sell ->> 'loan' AS s FROM investors WHERE id = ${c}::uuid`)).s).toBe("interested");
    const past = await tx((t) => J.advanceOpportunity(t, actor(u.rm), o.id, { to: "lost", lostReason: "x", revisitOn: "2020-01-01" }));
    expect(past.ok).toBe(false);
    await tx((t) => J.advanceOpportunity(t, actor(u.rm), o.id, { to: "lost", lostReason: "Not now" }));
    expect((await one(sql`SELECT cross_sell ->> 'loan' AS s FROM investors WHERE id = ${c}::uuid`)).s).toBe("held_elsewhere");
    const c2 = await client();
    const o2 = await open(c2, "demat");
    await tx((t) => J.advanceOpportunity(t, actor(u.rm), o2.id, { to: "lost", lostReason: "Not now" }));
    expect((await one(sql`SELECT cross_sell ->> 'demat' AS s FROM investors WHERE id = ${c2}::uuid`)).s).toBe("not_held");
  });

  it("O7: an FD recorded before the opportunity opened never wins it", async () => {
    const c = await client();
    const o = await open(c, "fd_bonds_ncd");
    const early = new Date(o.createdAt.getTime() - 864e5);
    expect(await tx((t) => J.onProductBooked(t, actor(u.rm), c, "fd_bonds_ncd", "old FD", { bookedAt: early }))).toBeNull();
    expect((await row(o.id)).status).toBe("open");
    expect(await tx((t) => J.onProductBooked(t, actor(u.rm), c, "fd_bonds_ncd", "new FD", { bookedAt: new Date() }))).toBe(o.id);
  });

  it("O11: a closed client's open opportunities close", async () => {
    const c = await client();
    const o = await open(c, "nps");
    await q(sql`UPDATE investors SET status = 'closed' WHERE id = ${c}::uuid`);
    expect(await tx((t) => J.closeOpportunitiesOfGoneClients(t, actor(""), [c]))).toBe(1);
    expect((await row(o.id)).status).toBe("lost");
  });

  it("O12: the money coming in brings a parked opportunity back with a follow-up", async () => {
    const c = await client();
    const o = await open(c, "mutual_funds");
    const day = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
    const parked = await tx(async (t) => L.parkOpportunity(t, actor(u.rm), await oppOf(t, o.id),
      { revisitOn: day, reason: "", money: { sourceType: "bonus", amount: 100000 } }));
    expect(parked.inflowId).toBeTruthy();
    await q(sql`UPDATE expected_inflows SET status = 'invested' WHERE id = ${parked.inflowId}::uuid`);
    await tx((t) => L.onInflowChanged(t, actor(u.rm), parked.inflowId!, "invested"));
    const r = await row(o.id);
    expect(r.parked_at).toBeNull();
    const fu = await one(sql`SELECT count(*)::int AS n FROM tasks WHERE meta ->> 'opportunityId' = ${o.id} AND status = 'open' AND description LIKE '%come in%'`);
    expect(fu.n).toBe(1);
    // The inflow's reminder is no longer the opportunity's.
    const rem = await one(sql`SELECT t.meta ? 'opportunityId' AS tagged FROM tasks t JOIN expected_inflows e ON e.reminder_task_id = t.id WHERE e.id = ${parked.inflowId}::uuid`);
    expect(rem.tagged).toBe(false);
  });

  it("O17: an overdue revisit escalates to the reporting manager when the owner is the branch head", async () => {
    const c = await client();
    const o = await tx((t) => J.createOpportunity(t, actor(u.head), { investorId: c, product: "other", ownerId: u.head })).then((r) => r.opportunity);
    const day = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
    await tx(async (t) => L.parkOpportunity(t, actor(u.head), await oppOf(t, o.id), { revisitOn: day, reason: "later" }));
    await q(sql`UPDATE tasks SET due_at = now() - interval '10 days' WHERE meta ->> 'opportunityId' = ${o.id} AND meta ->> 'revisit' = 'true'`);
    await tx((t) => L.escalateOverdueRevisits(t, tenant));
    const to = await one(sql`SELECT array_agg(user_id::text) AS u FROM notifications WHERE tenant_id = ${tenant}::uuid AND kind = 'opportunity.revisit_overdue'`);
    expect(to.u).toContain(u.boss);
    expect(to.u).not.toContain(u.head);
  });

  it("O18: the client's RM is told when someone else opens one for their client", async () => {
    const c = await client();
    await tx((t) => J.createOpportunity(t, actor(u.ops), { investorId: c, product: "demat", ownerId: u.ops }));
    const nt = await one(sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${u.rm}::uuid AND kind = 'opportunity.opened_for_client'`);
    expect(nt.n).toBeGreaterThanOrEqual(1);
  });
});
