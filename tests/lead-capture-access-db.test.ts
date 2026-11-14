/**
 * Lead capture, access and admin on a real database (journey audit L3, L4,
 * L12, L13, L14, L17, L19, L20, L21, C8). Runs the real route handlers under
 * RLS (TEST_DATABASE_URL); only the session and the licence gate are stubbed.
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
  assertModuleEnabled: async () => {},
  assertInvestorQuota: async () => {},
}));

describe.skipIf(!TEST_DB)("lead capture, access and admin (DB)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let routes: {
    checkDup: typeof import("@/app/api/leads/check-duplicate/route").POST;
    create: typeof import("@/app/api/leads/route").POST;
    list: typeof import("@/app/api/leads/route").GET;
    patch: typeof import("@/app/api/leads/[id]/route").PATCH;
    del: typeof import("@/app/api/leads/[id]/route").DELETE;
    restore: typeof import("@/app/api/leads/[id]/restore/route").POST;
    bulk: typeof import("@/app/api/leads/bulk/route").POST;
    callOutcome: typeof import("@/app/api/leads/[id]/call-outcome/route").POST;
    won: typeof import("@/app/api/leads/[id]/won/route").POST;
    docChecklist: typeof import("@/app/api/leads/[id]/send-doc-checklist/route").POST;
    dispatch: typeof import("@/app/api/leads/[id]/dispatch/route").POST;
    importCommit: typeof import("@/app/api/leads/import/commit/route").POST;
    publicForm: typeof import("@/app/api/public/lead-forms/[slug]/route").POST;
    createInvestor: typeof import("@/app/api/investors/route").POST;
  };

  const tenant = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const owner = randomUUID();
  const headA = randomUUID(); // branch head of A
  const rmA = randomUUID(); // RM in A, reports to teamLead
  const rmA2 = randomUUID(); // RM in A
  const rmB = randomUUID(); // RM in B
  const teamLead = randomUUID(); // an RM others report to
  const slug = `lf-${tenant.slice(0, 8)}`;
  const clientId = randomUUID();
  let seq = 0;
  const phone = () => `98${String(70000000 + Math.floor(Math.random() * 9999999) + ++seq).slice(0, 8)}`;
  const pan = () => {
    const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const r = (n: number) => Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join("");
    return `${r(3)}P${r(1)}${String(1000 + Math.floor(Math.random() * 8999))}${r(1)}`;
  };

  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const one = async <T,>(text: ReturnType<typeof import("drizzle-orm").sql>) => ((await q(text)).rows[0] ?? null) as T | null;
  const as = (userId: string, roles: string[], branchId: string | null = null) => {
    state.session = { tenantId: tenant, userId, roles, permissions: null, branchId, name: roles[0] };
  };
  const req = (path: string, body?: unknown, method = "POST") =>
    new NextRequest(`https://crm.test${path}`, {
      method: body === undefined && method === "POST" ? "GET" : method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${seq % 250}.${++seq % 250}` },
    });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const lead = (id: string) => one<any>(sql`SELECT * FROM leads WHERE id = ${id}::uuid`);
  const insertLead = async (p: { owner: string; branch: string | null; stage?: string; phone?: string; name?: string; lost?: string | null; converted?: string | null }) => {
    const id = randomUUID();
    const ph = p.phone ?? phone();
    await q(sql`INSERT INTO leads (id, tenant_id, branch_id, name, phone, phone_normalized, stage, source, owner_id, lost_reason, converted_investor_id)
                VALUES (${id}::uuid, ${tenant}::uuid, ${p.branch}::uuid, ${p.name ?? "Lead " + id.slice(0, 4)}, ${ph}, ${ph.slice(-10)},
                        ${p.stage ?? "new"}, 'manual', ${p.owner}::uuid, ${p.lost ?? null}, ${p.converted ?? null}::uuid)`);
    return id;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    routes = {
      checkDup: (await import("@/app/api/leads/check-duplicate/route")).POST,
      create: (await import("@/app/api/leads/route")).POST,
      list: (await import("@/app/api/leads/route")).GET,
      patch: (await import("@/app/api/leads/[id]/route")).PATCH,
      del: (await import("@/app/api/leads/[id]/route")).DELETE,
      restore: (await import("@/app/api/leads/[id]/restore/route")).POST,
      bulk: (await import("@/app/api/leads/bulk/route")).POST,
      callOutcome: (await import("@/app/api/leads/[id]/call-outcome/route")).POST,
      won: (await import("@/app/api/leads/[id]/won/route")).POST,
      docChecklist: (await import("@/app/api/leads/[id]/send-doc-checklist/route")).POST,
      dispatch: (await import("@/app/api/leads/[id]/dispatch/route")).POST,
      importCommit: (await import("@/app/api/leads/import/commit/route")).POST,
      publicForm: (await import("@/app/api/public/lead-forms/[slug]/route")).POST,
      createInvestor: (await import("@/app/api/investors/route")).POST,
    };
    const { ensureActiveBlueprint } = await import("@/lib/blueprints/engine");

    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Lead Access Test', 'Lead Access Test', ${"ARN-LA-" + tenant.slice(0, 6)})`);
    await q(sql`INSERT INTO branches (id, tenant_id, name, code) VALUES (${branchA}::uuid, ${tenant}::uuid, 'Branch A', 'A'), (${branchB}::uuid, ${tenant}::uuid, 'Branch B', 'B')`);
    for (const [id, role, branch, manager] of [
      [owner, "owner", null, null],
      [headA, "branch_head", branchA, null],
      [teamLead, "rm", branchA, null],
      [rmA, "rm", branchA, teamLead],
      [rmA2, "rm", branchA, null],
      [rmB, "rm", branchB, null],
    ] as const) {
      await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status, branch_id, reporting_manager_id)
                  VALUES (${id}::uuid, ${tenant}::uuid, ${id.slice(0, 8) + "@" + tenant.slice(0, 8) + ".test"}, ${role + "-" + id.slice(0, 4)},
                          ${`{${role}}`}::text[], 'active', ${branch}::uuid, ${manager}::uuid)`);
    }
    await withSystem((tx) => ensureActiveBlueprint(tx as any, tenant));
    await q(sql`INSERT INTO investors (id, tenant_id, name, pan, phone, email, rm_id, branch_id, status)
                VALUES (${clientId}::uuid, ${tenant}::uuid, 'Kiran Client', ${pan()}, '9800011111', 'kiran.client@example.test', ${rmB}::uuid, ${branchB}::uuid, 'active')`);
    await q(sql`INSERT INTO lead_capture_forms (tenant_id, name, slug, lead_source, enabled, rate_limit_per_hour)
                VALUES (${tenant}::uuid, 'Website enquiry', ${slug}, 'website', true, '50')`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const table of [
      "privacy_consents", "notifications", "audit_log", "events_outbox", "lead_stage_history", "lead_blueprint_instances", "tasks",
      "communications", "share_tokens", "templates", "template_versions", "activities", "lead_capture_forms", "leads", "investors",
      "blueprint_transitions", "blueprint_stages", "blueprint_definitions", "users", "branches",
    ]) {
      await q(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  it("L3: the duplicate check never shows another RM's lead — only that one exists", async () => {
    const ph = phone();
    const theirs = await insertLead({ owner: rmB, branch: branchB, phone: ph, name: "Secret Sharma" });

    as(rmA, ["rm"], branchA);
    const res = await routes.checkDup(req("/api/leads/check-duplicate", { phone: ph }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches).toEqual([{ outsideScope: true, matchedOn: ["phone"] }]);
    expect(JSON.stringify(body)).not.toContain("Secret Sharma");
    expect(JSON.stringify(body)).not.toContain(theirs);

    as(rmB, ["rm"], branchB);
    const mine = await (await routes.checkDup(req("/api/leads/check-duplicate", { phone: ph }))).json();
    expect(mine.matches[0]).toMatchObject({ id: theirs, name: "Secret Sharma" });

  });

  it("L21: a new lead needs a name and a phone or email; a bad PAN is refused with its field", async () => {
    as(rmA, ["rm"], branchA);
    const noContact = await routes.create(req("/api/leads", { name: "Nobody Reachable" }));
    expect(noContact.status).toBe(400);
    const badPhone = await routes.create(req("/api/leads", { name: "Short Phone", phone: "12345" }));
    expect(badPhone.status).toBe(400);
    expect((await badPhone.json()).field).toBe("phone");
    const badPan = await routes.create(req("/api/leads", { name: "Bad Pan", phone: phone(), pan: "ABC12" }));
    expect(badPan.status).toBe(400);
    expect((await badPan.json()).field).toBe("pan");
    const ok = await routes.create(req("/api/leads", { name: "Plus Ninety One", phone: "+91 " + phone() }));
    expect(ok.status).toBe(201);
  });

  it("L12 + L13: a lead's branch is its owner's; reassignment moves branch, follow-ups and notifies", async () => {
    as(owner, ["owner"]);
    const res = await routes.create(req("/api/leads", { name: "Branch Follower", phone: phone(), ownerId: rmB, followUpDate: new Date(Date.now() + 86400000).toISOString() }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect((await lead(id)).branch_id).toBe(branchB);
    expect(await one(sql`SELECT 1 FROM notifications WHERE user_id = ${rmB}::uuid AND kind = 'lead.assigned' AND meta->>'lead_id' = ${id}`)).not.toBeNull();

    const p = await routes.patch(req(`/api/leads/${id}`, { ownerId: rmA }, "PATCH"), params(id));
    expect(p.status).toBe(200);
    const after = await lead(id);
    expect(after.owner_id).toBe(rmA);
    expect(after.branch_id).toBe(branchA);
    const fu = await one<{ assignee_id: string }>(sql`SELECT assignee_id FROM tasks WHERE related_lead_id = ${id}::uuid AND status = 'open'`);
    expect(fu?.assignee_id).toBe(rmA);
    expect(await one(sql`SELECT 1 FROM notifications WHERE user_id = ${rmA}::uuid AND kind = 'lead.assigned' AND meta->>'lead_id' = ${id}`)).not.toBeNull();
  });

  it("L13: round-robin counts only open leads", async () => {
    const { pickRmForNewLead } = await import("@/lib/leads/assign");
    const { withTenant } = await import("@/db/client");
    // Everyone else holds at least one open lead; rmA2 holds only closed ones
    // (lost, deleted, converted) — so rmA2 is the least loaded with OPEN leads.
    await insertLead({ owner: teamLead, branch: branchA, stage: "new" });
    for (let i = 0; i < 4; i++) await insertLead({ owner: rmA2, branch: branchA, stage: "not_qualified" });
    await insertLead({ owner: rmA2, branch: branchA, stage: "new", lost: "__deleted__" });
    await insertLead({ owner: rmA2, branch: branchA, stage: "won_lead", converted: clientId });
    await insertLead({ owner: rmA2, branch: branchA, stage: "request_documents", converted: clientId });
    const picked = await withTenant(tenant, (tx) => pickRmForNewLead(tx, { strategy: "least_loaded" }));
    expect(picked).toBe(rmA2);
  });

  it("team scope: a team lead sees a report's lead but cannot edit it", async () => {
    const reportLead = await insertLead({ owner: rmA, branch: branchA, name: "Report Lead" });
    as(teamLead, ["rm"], branchA);
    const list = await (await routes.list(new NextRequest("https://crm.test/api/leads?limit=400"))).json();
    expect(list.leads.map((l: any) => l.id)).toContain(reportLead);
    const p = await routes.patch(req(`/api/leads/${reportLead}`, { city: "Pune" }, "PATCH"), params(reportLead));
    expect(p.status).toBe(403);
    // A peer sees nothing of it.
    as(rmA2, ["rm"], branchA);
    const peer = await (await routes.list(new NextRequest("https://crm.test/api/leads?limit=400"))).json();
    expect(peer.leads.map((l: any) => l.id)).not.toContain(reportLead);
  });

  it("L4 + L14: bulk acts only inside the caller's scope, through the journey, and closes follow-ups", async () => {
    const inA = await insertLead({ owner: rmA, branch: branchA, stage: "call_done" });
    const inB = await insertLead({ owner: rmB, branch: branchB, stage: "call_done" });
    const { startJourneyAt } = await import("@/lib/blueprints/journey-access");
    for (const id of [inA, inB]) await withSystem((tx) => startJourneyAt(tx as any, tenant, id, "call_done"));
    for (const [id, who] of [[inA, rmA], [inB, rmB]] as const) {
      await q(sql`INSERT INTO tasks (tenant_id, subject_type, subject_id, related_lead_id, type, title, status, assignee_id)
                  VALUES (${tenant}::uuid, 'lead', ${id}::uuid, ${id}::uuid, 'follow_up', 'Call back', 'open', ${who}::uuid)`);
    }

    as(headA, ["branch_head"], branchA);
    const res = await routes.bulk(req("/api/leads/bulk", { ids: [inA, inB], action: "lost", value: "Not interested" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(1);
    expect(body.skippedLeads).toEqual([{ id: inB, reason: "Not in your leads" }]);
    expect((await lead(inA)).stage).toBe("not_qualified");
    expect((await lead(inA)).lost_reason).toBe("Not interested");
    expect((await one<{ k: string }>(sql`SELECT current_stage_key AS k FROM lead_blueprint_instances WHERE lead_id = ${inA}::uuid`))?.k).toBe("not_qualified");
    expect((await one<{ s: string }>(sql`SELECT status AS s FROM tasks WHERE related_lead_id = ${inA}::uuid`))?.s).toBe("cancelled");
    // The other branch's lead is untouched.
    expect((await lead(inB)).stage).toBe("call_done");
    expect((await one<{ s: string }>(sql`SELECT status AS s FROM tasks WHERE related_lead_id = ${inB}::uuid`))?.s).toBe("open");

    // Bulk assign within scope moves the branch with the owner.
    const inA2 = await insertLead({ owner: rmA, branch: branchA });
    const asg = await (await routes.bulk(req("/api/leads/bulk", { ids: [inA2, inB], action: "assign", value: rmA2 }))).json();
    expect(asg.updated).toBe(1);
    expect((await lead(inA2)).owner_id).toBe(rmA2);
    expect((await lead(inB)).owner_id).toBe(rmB);
  });

  it("L14: 'call later' twice keeps ONE reminder and sets the next follow-up", async () => {
    const id = await insertLead({ owner: rmA, branch: branchA, stage: "new" });
    as(rmA, ["rm"], branchA);
    const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    for (const d of [2, 5]) {
      const r = await routes.callOutcome(req(`/api/leads/${id}/call-outcome`, { outcome: "call_later", followUpDate: day(d) }), params(id));
      expect(r.status).toBe(201);
    }
    const open = (await q(sql`SELECT due_at FROM tasks WHERE related_lead_id = ${id}::uuid AND type = 'follow_up' AND status = 'open'`)).rows as any[];
    expect(open).toHaveLength(1);
    const l = await lead(id);
    expect(l.next_follow_up_at).not.toBeNull();
    expect(new Date(l.next_follow_up_at).toISOString().slice(0, 10)).toBe(new Date(open[0].due_at).toISOString().slice(0, 10));
  });

  it("L20: a deleted lead's follow-ups are cancelled and the lead can be restored at its step", async () => {
    const id = await insertLead({ owner: rmA, branch: branchA, stage: "meeting_scheduled" });
    const { startJourneyAt } = await import("@/lib/blueprints/journey-access");
    await withSystem((tx) => startJourneyAt(tx as any, tenant, id, "meeting_scheduled"));
    await q(sql`INSERT INTO tasks (tenant_id, subject_type, subject_id, related_lead_id, type, title, status, assignee_id)
                VALUES (${tenant}::uuid, 'lead', ${id}::uuid, ${id}::uuid, 'call', 'Confirm the meeting', 'open', ${rmA}::uuid)`);
    as(rmA, ["rm"], branchA);
    expect((await routes.del(req(`/api/leads/${id}`, undefined, "DELETE"), params(id))).status).toBe(200);
    expect((await lead(id)).lost_reason).toBe("__deleted__");
    expect((await one<{ s: string }>(sql`SELECT status AS s FROM tasks WHERE related_lead_id = ${id}::uuid`))?.s).toBe("cancelled");
    expect((await one<{ s: string }>(sql`SELECT status AS s FROM lead_blueprint_instances WHERE lead_id = ${id}::uuid`))?.s).toBe("lost");

    // An RM may not restore; the branch head may.
    expect((await routes.restore(req(`/api/leads/${id}/restore`, {}), params(id))).status).toBe(403);
    as(headA, ["branch_head"], branchA);
    const r = await routes.restore(req(`/api/leads/${id}/restore`, {}), params(id));
    expect(r.status).toBe(200);
    expect((await r.json()).stage).toBe("meeting_scheduled");
    const back = await lead(id);
    expect(back.lost_reason).toBeNull();
    expect(back.stage).toBe("meeting_scheduled");
    expect((await one<{ s: string }>(sql`SELECT status AS s FROM lead_blueprint_instances WHERE lead_id = ${id}::uuid`))?.s).toBe("in_progress");
  });

  it("L21: /won saves no products when the move is refused", async () => {
    const id = await insertLead({ owner: rmA, branch: branchA, stage: "won_lead", converted: clientId });
    await q(sql`UPDATE leads SET interest_products = '["Equity MF"]'::jsonb WHERE id = ${id}::uuid`);
    const { startJourneyAt } = await import("@/lib/blueprints/journey-access");
    await withSystem((tx) => startJourneyAt(tx as any, tenant, id, "won_lead"));
    await withSystem((tx) => startJourneyAt(tx as any, tenant, id, "add_in_review_sheet"));
    as(rmA, ["rm"], branchA);
    const r = await routes.won(req(`/api/leads/${id}/won`, { products: ["Insurance"], primaryProduct: "Insurance" }), params(id));
    expect(r.status).toBe(409);
    const l = await lead(id);
    expect(l.interest_products).toEqual(["Equity MF"]);
    expect(l.pipeline).toBe("mf");
  });

  it("L17: only someone who may edit the lead can send it the checklist or a template", async () => {
    const theirs = await insertLead({ owner: rmB, branch: branchB });
    as(rmA, ["rm"], branchA);
    expect((await routes.docChecklist(req(`/api/leads/${theirs}/send-doc-checklist`, {}), params(theirs))).status).toBe(403);
    const d = await routes.dispatch(req(`/api/leads/${theirs}/dispatch`, { channel: "email", templateKey: "x" }), params(theirs));
    expect(d.status).toBe(403);
    expect(await one(sql`SELECT 1 FROM share_tokens WHERE subject_id = ${theirs}::uuid`)).toBeNull();
  });

  it("L19: the import normalises, validates PAN, skips duplicates and assigns owners", async () => {
    const existingLeadPhone = phone();
    await insertLead({ owner: rmA, branch: branchA, phone: existingLeadPhone });
    const fresh = phone();
    const rmBEmail = (await one<{ e: string }>(sql`SELECT email AS e FROM users WHERE id = ${rmB}::uuid`))!.e;
    as(owner, ["owner"]);
    const res = await routes.importCommit(req("/api/leads/import/commit", {
      mapping: { Name: "name", Mobile: "phone", PAN: "pan", Owner: "owner", Source: "source" },
      rows: [
        { Name: "Fresh Import", Mobile: `+91-${fresh.slice(0, 5)}-${fresh.slice(5)}`, PAN: "", Owner: rmBEmail.toUpperCase(), Source: "Google Ads" },
        { Name: "Bad Pan Row", Mobile: phone(), PAN: "NOTAPAN", Owner: "", Source: "" },
        { Name: "Client Again", Mobile: "98000 11111", PAN: "", Owner: "", Source: "" },
        { Name: "Lead Again", Mobile: existingLeadPhone, PAN: "", Owner: "", Source: "" },
        { Name: "Same File Twice", Mobile: fresh, PAN: "", Owner: "", Source: "" },
        { Name: "Unknown Owner", Mobile: phone(), PAN: "", Owner: "nobody@example.test", Source: "" },
      ],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.skipped).toBe(3);
    expect(body.errored).toBe(2);
    expect(body.errors.map((e: any) => e.rowIndex).sort()).toEqual([1, 5]);
    expect(body.skippedRows.find((s: any) => s.rowIndex === 2).reason).toContain("already a client");
    const imported = await one<any>(sql`SELECT * FROM leads WHERE tenant_id = ${tenant}::uuid AND name = 'Fresh Import'`);
    expect(imported.phone_normalized).toBe(fresh);
    expect(imported.owner_id).toBe(rmB);
    expect(imported.branch_id).toBe(branchB);
    expect(imported.source).toBe("google_ads");
    expect(await one(sql`SELECT 1 FROM notifications WHERE user_id = ${rmB}::uuid AND kind = 'lead.assigned' AND meta->>'how' = 'imported'`)).not.toBeNull();
  });

  it("L19: a public form from an existing client or lead never makes a duplicate lead", async () => {
    state.session = null;
    const before = Number((await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM leads WHERE tenant_id = ${tenant}::uuid`))!.n);
    const asClient = await routes.publicForm(req(`/api/public/lead-forms/${slug}`, { name: "Kiran C", phone: "9800011111", privacyConsent: true }), { params: Promise.resolve({ slug }) });
    expect(asClient.status).toBe(200);
    expect(await one(sql`SELECT 1 FROM tasks WHERE related_investor_id = ${clientId}::uuid AND assignee_id = ${rmB}::uuid AND title LIKE 'Website enquiry%'`)).not.toBeNull();

    const known = phone();
    const leadId = await insertLead({ owner: rmA, branch: branchA, phone: known });
    const asLead = await routes.publicForm(req(`/api/public/lead-forms/${slug}`, { name: "Known Lead", phone: known, notes: "Call me after 6", privacyConsent: true }), { params: Promise.resolve({ slug }) });
    expect(asLead.status).toBe(200);
    expect((await lead(leadId)).notes).toContain("Call me after 6");
    const after = Number((await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM leads WHERE tenant_id = ${tenant}::uuid`))!.n);
    expect(after).toBe(before + 1); // only the insertLead above

    // Someone new: a lead in its owner's branch, and the owner is told.
    const fresh = await routes.publicForm(req(`/api/public/lead-forms/${slug}`, { name: "New Person", phone: phone(), privacyConsent: true }), { params: Promise.resolve({ slug }) });
    const { leadId: newId } = await fresh.json();
    expect(newId).toBeTruthy();
    const nl = await lead(newId);
    expect(nl.owner_id).toBeTruthy();
    const ownerBranch = await one<{ b: string | null }>(sql`SELECT branch_id AS b FROM users WHERE id = ${nl.owner_id}::uuid`);
    expect(nl.branch_id).toBe(ownerBranch?.b ?? null);
  });

  it("C8: an RM cannot record KYC Verified on Add client; operations can", async () => {
    as(rmA, ["rm"], branchA);
    const r = await routes.createInvestor(req("/api/investors", { name: "Kyc Pending Person", pan: pan(), dob: "1985-05-05", kycStatus: "verified" }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.kycNotice).toContain("Pending");
    expect((await one<{ k: string }>(sql`SELECT kyc_status AS k FROM investors WHERE id = ${body.id}::uuid`))?.k).toBe("pending");

    as(owner, ["owner"]);
    const ok = await routes.createInvestor(req("/api/investors", { name: "Kyc Verified Person", pan: pan(), dob: "1985-05-05", kycStatus: "verified" }));
    expect(ok.status).toBe(201);
    const okBody = await ok.json();
    expect(okBody.kycNotice).toBeUndefined();
    expect((await one<{ k: string }>(sql`SELECT kyc_status AS k FROM investors WHERE id = ${okBody.id}::uuid`))?.k).toBe("verified");
  });
});
