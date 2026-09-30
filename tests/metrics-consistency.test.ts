/**
 * lib/metrics against a real database: the figures that used to disagree now
 * come out of one definition each.
 *
 *   - the SIP rows add up to the SIP book KPI, and to the Clients list's
 *     "Monthly SIP" column (the per-client cache), frequencies converted;
 *   - new clients are counted by onboarding date, never created_at;
 *   - the lead conversion rate is the Won count over the same leads;
 *   - overdue tasks count blocked work and skip finished and deleted work;
 *   - a client's stored health score equals the live score after a view.
 *
 * Needs a migrated Postgres via TEST_DATABASE_URL — skipped otherwise. Builds
 * its own throwaway firm and removes it afterwards.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("metrics consistency (DB)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let m: typeof import("@/lib/metrics");
  let health: typeof import("@/lib/investors/health");
  let sql: typeof import("drizzle-orm").sql;
  let eq: typeof import("drizzle-orm").eq;
  let schema: typeof import("@/db/schema");

  const tenantId = randomUUID();
  const rmId = randomUUID();
  const inv = { live: randomUUID(), second: randomUUID(), closed: randomUUID(), imported: randomUUID() };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    m = await import("@/lib/metrics");
    health = await import("@/lib/investors/health");
    ({ sql, eq } = await import("drizzle-orm"));
    schema = await import("@/db/schema");

    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn)
        VALUES (${tenantId}::uuid, 'Metrics Test', 'Metrics Test', ${`ARN-MT-${tenantId.slice(0, 6)}`})`);
      await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status)
        VALUES (${rmId}::uuid, ${tenantId}::uuid, ${`rm-${tenantId.slice(0, 6)}@metrics.test`}, 'Test RM', ARRAY['rm']::text[], 'active')`);
      const client = (id: string, name: string, pan: string, status: string, onboarded: string | null) => sql`
        INSERT INTO investors (id, tenant_id, pan, name, status, rm_id, onboarded_at, created_at, aum)
        VALUES (${id}::uuid, ${tenantId}::uuid, ${pan}, ${name}, ${status}, ${rmId}::uuid,
                ${onboarded}::timestamptz, now(), 100000)`;
      await tx.execute(client(inv.live, "Live Client", "MTAPL1111A", "active", "2026-05-10T10:00:00+05:30"));
      await tx.execute(client(inv.second, "Dormant Client", "MTAPL2222B", "dormant", "2025-01-10T10:00:00+05:30"));
      await tx.execute(client(inv.closed, "Closed Client", "MTAPL3333C", "closed", "2026-06-01T10:00:00+05:30"));
      // An imported record: created today, onboarding date unknown — NOT new.
      await tx.execute(client(inv.imported, "Imported Client", "MTAPL4444D", "active", null));

      const sip = (investor: string, amount: number, frequency: string, status: string) => sql`
        INSERT INTO sips (tenant_id, investor_id, scheme_name, amount, frequency, status, start_date)
        VALUES (${tenantId}::uuid, ${investor}::uuid, 'Test Fund', ${amount}, ${frequency}, ${status}, '2026-05-01')`;
      await tx.execute(sip(inv.live, 8000, "monthly", "active"));
      await tx.execute(sip(inv.live, 30000, "quarterly", "active"));
      await tx.execute(sip(inv.second, 60000, "half_yearly", "active"));
      await tx.execute(sip(inv.second, 5000, "monthly", "stopped"));
      await tx.execute(sip(inv.closed, 9000, "monthly", "active")); // a closed client is not in the book

      const lead = (stage: string, converted: string | null = null, deleted = false) => sql`
        INSERT INTO leads (tenant_id, name, source, stage, owner_id, converted_investor_id, lost_reason, created_at)
        VALUES (${tenantId}::uuid, 'Lead', 'referral', ${stage}, ${rmId}::uuid, ${converted}::uuid,
                ${deleted ? "__deleted__" : null}, '2026-06-15T10:00:00+05:30')`;
      for (const st of ["new", "contacted", "qualified", "proposal_shared", "meeting_done"]) await tx.execute(lead(st));
      await tx.execute(lead("won_lead"));
      await tx.execute(lead("kyc_pending", inv.live)); // converted, in onboarding → Won
      await tx.execute(lead("lost"));
      await tx.execute(lead("new", null, true)); // deleted — never counted

      const task = (status: string, dueSql: string, deleted = false) => sql`
        INSERT INTO tasks (tenant_id, subject_type, type, title, priority, status, assignee_id, due_at, deleted_at)
        VALUES (${tenantId}::uuid, 'internal', 'internal', 'T', 'normal', ${status}, ${rmId}::uuid,
                now() + ${sql.raw(`interval '${dueSql}'`)}, ${deleted ? sql`now()` : sql`NULL`})`;
      await tx.execute(task("open", "-2 days"));
      await tx.execute(task("blocked", "-1 days"));
      await tx.execute(task("in_progress", "+3 days"));
      await tx.execute(task("completed", "-5 days"));
      await tx.execute(task("open", "-5 days", true));
    });
  });

  afterAll(async () => {
    try {
      await withSystem(async (tx) => {
        for (const t of ["tasks", "leads", "sips", "service_requests"]) {
          await tx.execute(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenantId}::uuid`);
        }
        await tx.execute(sql`DELETE FROM investors WHERE tenant_id = ${tenantId}::uuid`);
        await tx.execute(sql`DELETE FROM users WHERE tenant_id = ${tenantId}::uuid`);
        await tx.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
      });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("the SIP rows add up to the SIP book KPI and to the Clients list's Monthly SIP", async () => {
    await withSystem(async (tx) => {
      await m.refreshActiveSipAmount(tx, { tenantId });
      const book = await m.getSipBook(tx, { tenantId });

      // What the SIP Book page lists: active SIPs of live clients.
      const rows = (await tx.execute(sql`
        SELECT s.amount, s.frequency FROM sips s JOIN investors i ON i.id = s.investor_id
         WHERE s.tenant_id = ${tenantId}::uuid AND s.status = 'active'
           AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND i.status NOT IN ('closed', 'exited')
      `)).rows as Array<{ amount: string; frequency: string }>;
      const sumOfRows = rows.reduce((s, r) => s + m.monthlySipAmount(r.amount, r.frequency), 0);

      // What the Clients list shows: the per-client cache over the same clients.
      const cache = (await tx.execute(sql`
        SELECT COALESCE(SUM(active_sip_amount), 0) AS v FROM investors i
         WHERE i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
           AND i.status NOT IN ('closed', 'exited')
      `)).rows[0] as { v: string };

      expect(book.monthly).toBeCloseTo(8000 + 10000 + 10000, 6);
      expect(book.monthly).toBeCloseTo(sumOfRows, 6);
      expect(Number(cache.v)).toBeCloseTo(book.monthly, 2);
      expect(book.sips).toBe(3);
      expect(book.clients).toBe(2);
    });
  });

  it("counts new clients by onboarding date, not by when the record was created", async () => {
    await withSystem(async (tx) => {
      const fy = { from: "2026-04-01", to: "2026-09-30" };
      // Live (May) + Closed (June — still won this year); the imported and the
      // 2025 client are not new, though all four were created today.
      expect(await m.getNewClients(tx, { tenantId }, fy)).toBe(2);
      expect(await m.getNewClients(tx, { tenantId }, { from: "2026-05-01", to: "2026-05-31" })).toBe(1);
      const counts = await m.getActiveClients(tx, { tenantId });
      expect(counts).toEqual({ clients: 3, active: 2, funded: 3 });
    });
  });

  it("puts every lead on one board column and converts Won over the same leads", async () => {
    await withSystem(async (tx) => {
      const c = await m.getLeadStageCounts(tx, { tenantId }, { from: "2026-06-01", to: "2026-06-30" });
      expect(c.byStage.new).toBe(1);
      expect(c.byStage.call_done).toBe(1);
      expect(c.byStage.meeting_scheduled).toBe(1); // "qualified"
      expect(c.byStage.meeting_done).toBe(1);
      expect(c.byStage.proposal_sent).toBe(1); // "proposal_shared"
      expect(c.won).toBe(2); // won_lead + the converted lead in onboarding
      expect(c.lost).toBe(1);
      expect(c.total).toBe(8); // the deleted lead is not counted
      expect(c.conversion).toBeCloseTo(2 / 8, 10);
      const open = await m.getOpenLeads(tx, { tenantId });
      expect(open.open).toBe(c.open);
    });
  });

  it("counts overdue tasks the same for the badge and the firm", async () => {
    await withSystem(async (tx) => {
      expect(await m.getOverdueTasks(tx, { tenantId, userId: rmId })).toBe(2);
      expect(await m.getOverdueTasks(tx, { tenantId })).toBe(2);
      expect(await m.getOverdueTasks(tx, { tenantId, rmIds: [rmId] })).toBe(2);
    });
  });

  it("stores the same health score the client page shows", async () => {
    await withSystem(async (tx) => {
      const live = await m.getClientHealth(tx, tenantId, inv.live);
      const stored = (await tx.execute(sql`SELECT health_score, health_band FROM investors WHERE id = ${inv.live}::uuid`)).rows[0] as {
        health_score: number; health_band: string;
      };
      expect(live).not.toBeNull();
      expect(stored.health_score).toBe(live!.score);
      expect(stored.health_band).toBe(live!.band);
      // A bare row with no contact, nominee, bank or risk profile is not 100.
      expect(live!.score).toBeLessThan(100);
      const [row] = await tx.select().from(schema.investors).where(eq(schema.investors.id, inv.live));
      expect(health.clientHealth(row as never).score).toBe(live!.score);
    });
  });
});
