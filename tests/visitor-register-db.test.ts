/**
 * The Visitor Register against the database: record, search, date filter, edit,
 * delete, whom a visitor may be meeting, that one firm never sees another's, and
 * that migration 0293 switches it on for Akshar Invest's ARN alone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureStarterPackage } from "./helpers/starter-package";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("visitor register against the database", () => {
  const tenant = crypto.randomUUID();
  const other = crypto.randomUUID();
  const owner = crypto.randomUUID();
  const colleague = crypto.randomUUID();
  const gone = crypto.randomUUID();
  const outsider = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let svc: typeof import("@/lib/visitors/service");
  let entry: typeof import("@/lib/visitors/entry");

  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const actor = { tenantId: tenant, userId: owner };
  const run = <T>(fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) => withTenant(tenant, fn, { userId: owner });
  const list = (params: Record<string, string> = {}) => run((tx) => svc.listVisitors(tx, tenant, entry.parseVisitorFilter(params)));
  const add = (input: Record<string, unknown>) => run((tx) => svc.createVisitor(tx, actor, entry.VisitorCreateBody.parse(input)));
  const names = async (params: Record<string, string>) => (await list(params)).rows.map((r) => r.visitorName);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    svc = await import("@/lib/visitors/service");
    entry = await import("@/lib/visitors/entry");
    for (const t of [tenant, other]) {
      await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Visitor Firm', 'Visitor Firm', ${"ARN-VR-" + t.slice(0, 8)})`);
    }
    const people: [string, string, string, string][] = [
      [owner, tenant, "Owner", "active"],
      [colleague, tenant, "Kiran Patel", "active"],
      [gone, tenant, "Left Already", "offboarded"],
      [outsider, other, "Other Firm Person", "active"],
    ];
    for (const [id, t, name, status] of people) {
      await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${id}::uuid, ${t}::uuid, ${"vr-" + id.slice(0, 8) + "@t.in"}, ${name}, ARRAY['owner']::text[], ${status})`);
    }
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of [tenant, other]) {
      for (const table of ["visitor_entries", "audit_log", "subscriptions", "users"]) {
        await q(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`)).catch(() => {});
      }
      await q(sql`DELETE FROM tenants WHERE id = ${t}::uuid`).catch(() => {});
    }
  });

  it("records every field and lists it newest first", async () => {
    const created = await add({
      visitorName: "Meera Shah", email: "meera@example.com", mobile: "+91 98765 43210", companyName: "Acme 100% Ltd",
      visitDate: "2026-11-20", entryTime: "10:30", exitTime: "11:15", purpose: "KYC papers\nand a form",
      meetingWithUserId: colleague, remarks: "Parked outside",
    });
    expect(created).toMatchObject({
      visitorName: "Meera Shah", entryTime: "10:30", exitTime: "11:15", meetingWithName: "Kiran Patel",
      createdByName: "Owner", visitDate: "2026-11-20", purpose: "KYC papers\nand a form",
    });
    await add({ visitorName: "Rohan Desai", visitDate: "2026-11-25" });
    expect(await names({})).toEqual(["Rohan Desai", "Meera Shah"]);
    expect((await list()).total).toBe(2);
  });

  it("searches across the fields, the phone however spaced, and takes % literally", async () => {
    for (const term of ["meera", "100%", "kiran", "parked", "kyc", "9876543210"]) {
      expect(await names({ q: term })).toEqual(["Meera Shah"]);
    }
    expect(await names({ q: "%" })).toEqual(["Meera Shah"]);
    expect(await names({ q: "_" })).toEqual([]);
    expect((await list({ q: "nobody" })).hasAny).toBe(true);
  });

  it("filters by visit date, both ends included", async () => {
    expect(await names({ visit_from: "2026-11-25" })).toEqual(["Rohan Desai"]);
    expect(await names({ visit_to: "2026-11-20" })).toEqual(["Meera Shah"]);
    expect(await names({ visit_from: "2026-11-20", visit_to: "2026-11-25" })).toHaveLength(2);
    expect(await names({ visit_from: "2026-12-01" })).toEqual([]);
  });

  it("filters by purpose and by whom they met, alone and together", async () => {
    expect(await names({ purpose: "kyc" })).toEqual(["Meera Shah"]);
    expect(await names({ purpose: "parked" })).toEqual([]); // that word is in the remarks
    expect(await names({ with: colleague })).toEqual(["Meera Shah"]);
    expect(await names({ with: `${colleague},${owner}` })).toEqual(["Meera Shah"]);
    expect(await names({ with: owner })).toEqual([]);
    expect(await names({ with: colleague, purpose: "kyc", visit_from: "2026-11-21" })).toEqual([]);
    expect((await list({ with: owner })).hasAny).toBe(true);
  });

  it("meets only an active team member of the same firm", async () => {
    for (const who of [outsider, gone, crypto.randomUUID()]) {
      await expect(add({ visitorName: "X", visitDate: "2026-11-26", meetingWithUserId: who })).rejects.toMatchObject({ status: 400 });
    }
    const staff = await run((tx) => svc.listMeetingUsers(tx, tenant));
    expect(staff.map((u) => u.name)).toEqual(["Kiran Patel", "Owner"]);
  });

  it("edits, clears a field, keeps a colleague who has left, and checks the times together", async () => {
    const [meera] = (await list({ q: "meera" })).rows;
    await q(sql`UPDATE users SET status = 'offboarded' WHERE id = ${colleague}::uuid`);
    const edited = await run((tx) => svc.updateVisitor(tx, actor, meera.id,
      entry.VisitorPatchBody.parse({ companyName: "", meetingWithUserId: colleague, exitTime: "12:00" })));
    expect(edited).toMatchObject({ companyName: null, meetingWithName: "Kiran Patel", exitTime: "12:00", entryTime: "10:30" });
    // The filter still offers the colleague who left, because a visit names them.
    const choices = await run((tx) => svc.listMeetingFilterUsers(tx, tenant));
    expect(choices.map((u) => u.name)).toEqual(["Kiran Patel", "Owner"]);
    await expect(run((tx) => svc.updateVisitor(tx, actor, meera.id, { exitTime: "09:00" }))).rejects.toMatchObject({ status: 400 });
    await expect(add({ visitorName: "X", visitDate: "2026-11-26", entryTime: "12:00", exitTime: "11:00" })).rejects.toMatchObject({ status: 400 });
  });

  it("another firm cannot read, edit or delete it", async () => {
    const [meera] = (await list({ q: "meera" })).rows;
    const theirs = { tenantId: other, userId: outsider };
    await withTenant(other, async (tx) => {
      expect(await svc.getVisitor(tx, other, meera.id)).toBeNull();
      expect((await svc.listVisitors(tx, other, entry.parseVisitorFilter({}))).total).toBe(0);
      // Row-level security alone, without the tenant condition the service adds.
      const raw = await tx.execute(sql`SELECT id FROM visitor_entries WHERE id = ${meera.id}::uuid`);
      const bypass = await tx.execute(sql`SELECT rolsuper OR rolbypassrls AS yes FROM pg_roles WHERE rolname = current_user`);
      if (!(bypass.rows[0] as { yes: boolean }).yes) expect(raw.rows).toHaveLength(0);
    });
    await expect(withTenant(other, (tx) => svc.updateVisitor(tx, theirs, meera.id, { remarks: "x" }))).rejects.toMatchObject({ status: 404 });
    await expect(withTenant(other, (tx) => svc.deleteVisitor(tx, theirs, meera.id))).rejects.toMatchObject({ status: 404 });
  });

  it("migration 0293 switches it on for ARN 110756 only, keeping the firm's other flags", async () => {
    await ensureStarterPackage(q, sql);
    const akshar = crypto.randomUUID();
    const longer = crypto.randomUUID(); // an ARN that merely contains the digits
    const firms: [string, string][] = [[akshar, "ARN-110756"], [longer, "ARN-1107561"]];
    try {
      for (const [id, arn] of firms) {
        await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, 'Switch T', 'Switch T', ${arn})`);
        await q(sql`INSERT INTO subscriptions (tenant_id, package_id, package_key, status, feature_flags_override)
          SELECT ${id}::uuid, p.id, p.key, 'active', '{"zohoImport": true}'::jsonb FROM packages p WHERE p.key = 'starter'`);
      }
      const file = readFileSync(join(__dirname, "../drizzle/migrations/0293_visitor_register.sql"), "utf8");
      // The switch-on only: the table above it is already there.
      const switchOn = file.slice(file.indexOf("SELECT set_config('app.is_platform_admin'"));
      for (let pass = 0; pass < 2; pass++) await withSystem((tx) => tx.execute(sql.raw(switchOn)));

      const flags = await q(sql`SELECT tenant_id, feature_flags_override AS f FROM subscriptions WHERE tenant_id IN (${akshar}::uuid, ${longer}::uuid)`);
      const of = (id: string) => (flags.rows as { tenant_id: string; f: unknown }[]).find((r) => r.tenant_id === id)?.f;
      expect(of(akshar)).toEqual({ zohoImport: true, visitorRegister: true });
      expect(of(longer)).toEqual({ zohoImport: true });
    } finally {
      for (const [id] of firms) {
        await q(sql`DELETE FROM subscriptions WHERE tenant_id = ${id}::uuid`).catch(() => {});
        await q(sql`DELETE FROM tenants WHERE id = ${id}::uuid`).catch(() => {});
      }
    }
  });

  it("exports what the filtered list shows, and the file imports again", async () => {
    await ensureStarterPackage(q, sql);
    const { runExport } = await import("@/lib/export/run");
    const { visitorsExport } = await import("@/lib/export/modules/visitors");
    const { runSheetImport } = await import("@/lib/imports/sheet/run");
    const { visitorsImport } = await import("@/lib/imports/sheet/visitors");
    const session = { tenantId: tenant, userId: owner, roles: ["owner"], name: "Owner", email: "o@t.in" } as any;
    const fields = visitorsExport.columns.map((c) => c.key);
    const download = (params: string) => runExport(session, visitorsExport, fields, "csv", new URLSearchParams(params));

    await expect(download("")).rejects.toMatchObject({ status: 404 }); // the switch is still off
    await q(sql`INSERT INTO subscriptions (tenant_id, package_id, package_key, status, feature_flags_override)
      SELECT ${tenant}::uuid, p.id, p.key, 'active', '{"visitorRegister": true}'::jsonb FROM packages p WHERE p.key = 'starter'`);

    // Kiran left earlier in this file; an import can only name an active team member.
    await q(sql`UPDATE users SET status = 'active' WHERE id = ${colleague}::uuid`);
    const all = await download("");
    expect(all.rows).toBe(2);
    const filtered = await download(`with=${colleague}&visit_from=2026-11-20&q=meera`);
    expect(filtered.rows).toBe(1);
    const text = filtered.body.toString("utf8");
    for (const s of ["Visitor Name", "Meeting with", "Meera Shah", "Kiran Patel", "2026-11-20", "10:30", "12:00"]) expect(text).toContain(s);

    const upload = (mode: "check" | "import") => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(all.body)], "visitors.csv"));
      return runSheetImport(new Request("http://test", { method: "POST", body: form }), session, visitorsImport, mode);
    };
    expect(await upload("check")).toMatchObject({ total: 2, valid: 2, invalid: 0, missing: [] });
    expect((await list()).total).toBe(2); // checking saves nothing
    expect(await upload("import")).toMatchObject({ imported: 2 });
    expect((await list()).total).toBe(4);
    expect((await list({ q: "meera", with: colleague })).total).toBe(2);
    await q(sql`DELETE FROM visitor_entries WHERE tenant_id = ${tenant}::uuid AND id NOT IN (
      SELECT DISTINCT entity_id FROM audit_log WHERE tenant_id = ${tenant}::uuid AND action = 'visitor.create')`);
    expect((await list()).total).toBe(2);
  });

  it("deletes from the register but keeps the row, and audits each change", async () => {
    const [meera] = (await list({ q: "meera" })).rows;
    await run((tx) => svc.deleteVisitor(tx, actor, meera.id));
    expect(await names({})).toEqual(["Rohan Desai"]);
    expect(await run((tx) => svc.getVisitor(tx, tenant, meera.id))).toBeNull();
    const kept = await q(sql`SELECT deleted_at FROM visitor_entries WHERE id = ${meera.id}::uuid`);
    expect((kept.rows[0] as { deleted_at: unknown }).deleted_at).toBeTruthy();
    const log = await q(sql`SELECT action FROM audit_log WHERE tenant_id = ${tenant}::uuid AND entity_id = ${meera.id}::uuid ORDER BY action`);
    expect(log.rows.map((r) => (r as { action: string }).action)).toEqual(["visitor.create", "visitor.delete", "visitor.update"]);
  });
});
