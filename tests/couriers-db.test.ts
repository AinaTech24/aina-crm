/**
 * Couriers against the database: record, search, filter, edit, change type,
 * delete, that one firm never sees another's, that migration 0294 switches it on
 * for Akshar Invest's ARN alone, and that an export imports again.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureStarterPackage } from "./helpers/starter-package";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("couriers against the database", () => {
  const tenant = crypto.randomUUID();
  const other = crypto.randomUUID();
  const owner = crypto.randomUUID();
  const outsider = crypto.randomUUID();
  let withSystem: typeof import("@/db/client").withSystem;
  let withTenant: typeof import("@/db/client").withTenant;
  let sql: typeof import("drizzle-orm").sql;
  let svc: typeof import("@/lib/couriers/service");
  let entry: typeof import("@/lib/couriers/entry");

  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));
  const actor = { tenantId: tenant, userId: owner };
  const run = <T>(fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) => withTenant(tenant, fn, { userId: owner });
  const list = (params: Record<string, string> = {}) => run((tx) => svc.listCouriers(tx, tenant, entry.parseCourierFilter(params)));
  const add = (input: Record<string, unknown>) => run((tx) => svc.createCourier(tx, actor, entry.CourierBody.parse(input)));
  const numbers = async (params: Record<string, string>) => (await list(params)).rows.map((r) => r.trackingNumber);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem, withTenant } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    svc = await import("@/lib/couriers/service");
    entry = await import("@/lib/couriers/entry");
    for (const t of [tenant, other]) {
      await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${t}::uuid, 'Courier Firm', 'Courier Firm', ${"ARN-CR-" + t.slice(0, 8)})`);
    }
    const people: [string, string, string][] = [[owner, tenant, "Owner"], [outsider, other, "Other Firm Person"]];
    for (const [id, t, name] of people) {
      await q(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${id}::uuid, ${t}::uuid, ${"cr-" + id.slice(0, 8) + "@t.in"}, ${name}, ARRAY['owner']::text[], 'active')`);
    }
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of [tenant, other]) {
      for (const table of ["courier_entries", "audit_log", "subscriptions", "users"]) {
        await q(sql.raw(`DELETE FROM ${table} WHERE tenant_id = '${t}'`)).catch(() => {});
      }
      await q(sql`DELETE FROM tenants WHERE id = ${t}::uuid`).catch(() => {});
    }
  });

  it("records every field of both types and lists the newest first", async () => {
    const received = await add({
      courierType: "inward", courierDate: "2026-11-20", status: "received", courierCompany: "Blue 100% Dart",
      trackingNumber: "IN-1", category: "kyc_documents", description: "Forms\nand a cheque", remarks: "At the desk",
      senderName: "Meera Shah", senderCompany: "Acme", senderMobile: "+91 98765 43210", senderEmail: "m@example.com",
      senderAddress: "12 Road\nAhmedabad", receivedDate: "2026-11-21",
    });
    expect(received).toMatchObject({
      courierType: "inward", senderName: "Meera Shah", receivedDate: "2026-11-21", createdByName: "Owner",
      description: "Forms\nand a cheque", recipientName: null, courierCharges: null,
    });
    const sent = await add({
      courierType: "outward", courierDate: "2026-11-25", status: "dispatched", courierCompany: "DTDC", trackingNumber: "OUT-2",
      category: "other", categoryOther: "Gift hamper", recipientName: "Rohan Desai", recipientMobile: "91234 56780",
      dispatchDate: "2026-11-25", courierCharges: "1,250.5", paymentMode: "upi",
    });
    expect(sent).toMatchObject({ courierCharges: "1250.50", paymentMode: "upi", categoryOther: "Gift hamper" });
    expect(await numbers({})).toEqual(["OUT-2", "IN-1"]);
  });

  it("searches across the fields, the phone however spaced, and takes % literally", async () => {
    for (const term of ["meera", "100%", "in-1", "at the desk", "9876543210"]) expect(await numbers({ q: term })).toEqual(["IN-1"]);
    expect(await numbers({ q: "hamper" })).toEqual(["OUT-2"]);
    expect(await numbers({ q: "%" })).toEqual(["IN-1"]);
    expect(await numbers({ q: "_" })).toEqual([]);
    expect((await list({ q: "nobody" })).hasAny).toBe(true);
  });

  it("filters by type, status, category, date and company", async () => {
    expect(await numbers({ type: "inward" })).toEqual(["IN-1"]);
    expect(await numbers({ status: "dispatched,lost" })).toEqual(["OUT-2"]);
    expect(await numbers({ category: "kyc_documents" })).toEqual(["IN-1"]);
    expect(await numbers({ courier_from: "2026-11-25" })).toEqual(["OUT-2"]);
    expect(await numbers({ courier_to: "2026-11-20" })).toEqual(["IN-1"]);
    expect(await numbers({ company: "dtdc" })).toEqual(["OUT-2"]);
    expect(await numbers({ type: "inward", company: "dtdc" })).toEqual([]);
  });

  it("edits what is sent and checks the courier as a whole", async () => {
    const [sent] = (await list({ q: "OUT-2" })).rows;
    const delivered = await run((tx) => svc.updateCourier(tx, actor, sent.id, { status: "delivered", deliveredDate: "2026-11-26" }));
    expect(delivered).toMatchObject({ status: "delivered", deliveredDate: "2026-11-26", courierCharges: "1250.50", recipientName: "Rohan Desai" });
    await expect(run((tx) => svc.updateCourier(tx, actor, sent.id, { deliveredDate: "2026-11-01" }))).rejects.toMatchObject({ status: 400 });
    await expect(run((tx) => svc.updateCourier(tx, actor, sent.id, { status: "received" }))).rejects.toMatchObject({ status: 400 });
    // Turning it round needs a status the new type has, and drops the recipient's details.
    await expect(run((tx) => svc.updateCourier(tx, actor, sent.id, { courierType: "inward" }))).rejects.toMatchObject({ status: 400 });
    const turned = await run((tx) => svc.updateCourier(tx, actor, sent.id, { courierType: "inward", status: "returned", senderName: "Rohan Desai" }));
    expect(turned).toMatchObject({ courierType: "inward", senderName: "Rohan Desai", recipientName: null, courierCharges: null, deliveredDate: null });
    await run((tx) => svc.updateCourier(tx, actor, sent.id, {
      courierType: "outward", status: "delivered", recipientName: "Rohan Desai", dispatchDate: "2026-11-25",
      deliveredDate: "2026-11-26", courierCharges: "1250.50", paymentMode: "upi",
    }));
  });

  it("another firm cannot read, edit or delete it", async () => {
    const [row] = (await list({ q: "IN-1" })).rows;
    const theirs = { tenantId: other, userId: outsider };
    await withTenant(other, async (tx) => {
      expect(await svc.getCourier(tx, other, row.id)).toBeNull();
      expect((await svc.listCouriers(tx, other, entry.parseCourierFilter({}))).total).toBe(0);
      // Row-level security alone, without the tenant condition the service adds.
      const raw = await tx.execute(sql`SELECT id FROM courier_entries WHERE id = ${row.id}::uuid`);
      const bypass = await tx.execute(sql`SELECT rolsuper OR rolbypassrls AS yes FROM pg_roles WHERE rolname = current_user`);
      if (!(bypass.rows[0] as { yes: boolean }).yes) expect(raw.rows).toHaveLength(0);
    });
    await expect(withTenant(other, (tx) => svc.updateCourier(tx, theirs, row.id, { remarks: "x" }))).rejects.toMatchObject({ status: 404 });
    await expect(withTenant(other, (tx) => svc.deleteCourier(tx, theirs, row.id))).rejects.toMatchObject({ status: 404 });
  });

  it("migration 0294 switches it on for ARN 110756 only, keeping the firm's other flags", async () => {
    await ensureStarterPackage(q, sql);
    const akshar = crypto.randomUUID();
    const longer = crypto.randomUUID(); // an ARN that merely contains the digits
    // Test files run side by side and the Visitor Register's test uses the real
    // ARN, so this one runs the same statement against a stand-in number.
    const digits = "770110756";
    const firms: [string, string][] = [[akshar, `ARN-${digits}`], [longer, `ARN-${digits}1`]];
    try {
      for (const [id, arn] of firms) {
        await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${id}::uuid, 'Courier Switch T', 'Courier Switch T', ${arn})`);
        await q(sql`INSERT INTO subscriptions (tenant_id, package_id, package_key, status, feature_flags_override)
          SELECT ${id}::uuid, p.id, p.key, 'active', '{"visitorRegister": true}'::jsonb FROM packages p WHERE p.key = 'starter'`);
      }
      const file = readFileSync(join(__dirname, "../drizzle/migrations/0294_couriers.sql"), "utf8");
      // The switch-on only: the table above it is already there.
      const switchOn = file.slice(file.indexOf("SELECT set_config('app.is_platform_admin'")).replace("'110756'", `'${digits}'`);
      for (let pass = 0; pass < 2; pass++) await withSystem((tx) => tx.execute(sql.raw(switchOn)));

      const flags = await q(sql`SELECT tenant_id, feature_flags_override AS f FROM subscriptions WHERE tenant_id IN (${akshar}::uuid, ${longer}::uuid)`);
      const of = (id: string) => (flags.rows as { tenant_id: string; f: unknown }[]).find((r) => r.tenant_id === id)?.f;
      expect(of(akshar)).toEqual({ visitorRegister: true, courierRegister: true });
      expect(of(longer)).toEqual({ visitorRegister: true });
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
    const { couriersExport } = await import("@/lib/export/modules/couriers");
    const { runSheetImport } = await import("@/lib/imports/sheet/run");
    const { couriersImport } = await import("@/lib/imports/sheet/couriers");
    const session = { tenantId: tenant, userId: owner, roles: ["owner"], name: "Owner", email: "o@t.in" } as any;
    const fields = couriersExport.columns.map((c) => c.key);
    const download = (params: string) => runExport(session, couriersExport, fields, "csv", new URLSearchParams(params));

    await expect(download("")).rejects.toMatchObject({ status: 404 }); // the switch is still off
    await q(sql`INSERT INTO subscriptions (tenant_id, package_id, package_key, status, feature_flags_override)
      SELECT ${tenant}::uuid, p.id, p.key, 'active', '{"courierRegister": true}'::jsonb FROM packages p WHERE p.key = 'starter'`);

    const all = await download("");
    expect(all.rows).toBe(2);
    const filtered = await download("type=outward&status=delivered&q=rohan");
    expect(filtered.rows).toBe(1);
    const text = filtered.body.toString("utf8");
    for (const s of ["Courier Type", "Delivered Date", "Outward", "Delivered", "Other", "Gift hamper", "UPI", "1250.5", "2026-11-26"]) {
      expect(text).toContain(s);
    }

    const upload = (mode: "check" | "import") => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(all.body)], "couriers.csv"));
      return runSheetImport(new Request("http://test", { method: "POST", body: form }), session, couriersImport, mode);
    };
    expect(await upload("check")).toMatchObject({ total: 2, valid: 2, invalid: 0, missing: [], problems: [] });
    expect((await list()).total).toBe(2); // checking saves nothing
    expect(await upload("import")).toMatchObject({ imported: 2 });
    expect((await list()).total).toBe(4);
    expect((await list({ q: "OUT-2" })).total).toBe(2);
    await q(sql`DELETE FROM courier_entries WHERE tenant_id = ${tenant}::uuid AND id NOT IN (
      SELECT DISTINCT entity_id FROM audit_log WHERE tenant_id = ${tenant}::uuid AND action = 'courier.create')`);
    expect((await list()).total).toBe(2);
  });

  it("deletes from the list but keeps the row, and audits each change", async () => {
    const [row] = (await list({ q: "IN-1" })).rows;
    await run((tx) => svc.deleteCourier(tx, actor, row.id));
    expect(await numbers({})).toEqual(["OUT-2"]);
    expect(await run((tx) => svc.getCourier(tx, tenant, row.id))).toBeNull();
    const kept = await q(sql`SELECT deleted_at FROM courier_entries WHERE id = ${row.id}::uuid`);
    expect((kept.rows[0] as { deleted_at: unknown }).deleted_at).toBeTruthy();
    const log = await q(sql`SELECT action FROM audit_log WHERE tenant_id = ${tenant}::uuid AND entity_id = ${row.id}::uuid ORDER BY action`);
    expect(log.rows.map((r) => (r as { action: string }).action)).toEqual(["courier.create", "courier.delete"]);
  });
});
