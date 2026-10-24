/**
 * An empty registrar placeholder is retired unless a PERSON's work is on it,
 * and the family's own bookkeeping is not a person's work.
 *
 * Nimesh C Shah, 15 Oct 2026: "Dilip Manilal Modi Huf (Huf)" (no PAN, empty,
 * made by the AUM statement) sat beside "Dilip Manilal Modi Huf" in the Modi
 * family. Changing the head's address had written `investor.details_from_family`
 * on every member in the user's request, and a queued notification named it —
 * the sweep read both as someone's work and kept it.
 *
 * Two halves: the duplicate rule the family page uses (pure), and the sweep
 * itself (DB-backed: needs a migrated Postgres in TEST_DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { findClusters } from "@/lib/investors/duplicate-clusters";

const rec = (id: string, name: string, pan: string | null = null) => ({
  id, name, pan, phone: null, alternate_phone: null, whatsapp_phone: null, email: null, dob: null,
  is_minor: false, aum: 0, rm_name: null,
});

describe("the family page's duplicate rule", () => {
  it("finds a person listed twice: with a PAN, and as the registrar spelt them without", () => {
    const found = findClusters([
      rec("a", "Dilip Manilal Modi Huf", "AAEHD0712J"),
      rec("b", "Dilip Manilal Modi Huf (Huf)"),
      rec("c", "SNEHAL DILIPKUMAR MODI HUF", "AAZHS4988Q"),
      rec("d", "Mona Snehal Modi", "AFWPM3286M"),
    ]).filter((c) => c.kind !== "Phone" && c.kind !== "Email");
    expect(found.map((c) => [...c.ids].sort())).toEqual([["a", "b"]]);
  });

  it("leaves a household alone: different people, one HUF per karta", () => {
    expect(findClusters([
      rec("a", "Snehal Dilipkumar Modi", "ACAPM0879R"),
      rec("b", "SNEHAL DILIPKUMAR MODI HUF", "AAZHS4988Q"),
      rec("c", "Dilip Manilal Modi Huf", "AAEHD0712J"),
    ]).filter((c) => c.kind !== "Phone" && c.kind !== "Email")).toEqual([]);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("findEmptyPlaceholders", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let find: typeof import("@/lib/rta/placeholder-sweep").findEmptyPlaceholders;
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const user = randomUUID();
  const family = randomUUID();
  const lonelyFamily = randomUUID();
  const ids = { pan: randomUUID(), twin: randomUUID(), noTwin: randomUUID(), edited: randomUUID(), plain: randomUUID() };

  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const client = (id: string, name: string, o: { pan?: string; key?: string; fam?: string } = {}) =>
    q(sql`INSERT INTO investors (id, tenant_id, name, pan, dedup_pan, rta_nopan_key, family_id, created_at)
          VALUES (${id}::uuid, ${tenant}::uuid, ${name}, ${o.pan ?? null}, ${!!o.pan}, ${o.key ?? null}, ${o.fam ?? null}::uuid, now() - interval '3 hours')`);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ findEmptyPlaceholders: find } = await import("@/lib/rta/placeholder-sweep"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Sweep Test', 'Sweep Test', ${"ARN-SW-" + tenant.slice(0, 6)})`);
    for (const f of [family, lonelyFamily]) {
      await q(sql`INSERT INTO families (id, tenant_id, head_name) VALUES (${f}::uuid, ${tenant}::uuid, 'Head')`);
    }
    // The Modi family: the PAN client and its empty twin, both members.
    await client(ids.pan, "Dilip Manilal Modi Huf", { pan: "AAEHD0712J", fam: family });
    await client(ids.twin, "Dilip Manilal Modi Huf (Huf)", { key: "NOPAN:NDILIPMANILALMODIHUFHUF", fam: family });
    // A member whose person is NOT otherwise in the family.
    await client(ids.noTwin, "Asha Rao", { key: "NOPAN:NASHARAO", fam: lonelyFamily });
    // One a person edited by hand.
    await client(ids.edited, "Ravi Iyer", { key: "NOPAN:NRAVIIYER" });
    // A plain one, in no family.
    await client(ids.plain, "Meena Joshi", { key: "NOPAN:NMEENAJOSHI" });

    // The family's bookkeeping on the twin: an automatic audit row written in the
    // user's request, and a queued notification that names it.
    for (const id of [ids.twin, ids.noTwin]) {
      await q(sql`INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id)
                  VALUES (${tenant}::uuid, ${user}::uuid, 'user', 'investor.details_from_family', 'investor', ${id}::uuid)`);
    }
    await q(sql`INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id) VALUES (${tenant}::uuid, 'client.updated', 'investor', ${ids.twin}::uuid)`);
    // A person's real edit.
    await q(sql`INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id)
                VALUES (${tenant}::uuid, ${user}::uuid, 'user', 'investor.update', 'investor', ${ids.edited}::uuid)`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["audit_log", "events_outbox", "investors", "families"]) {
      await q(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${tenant}::uuid`).catch(() => {});
    }
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
  });

  const found = async () => withSystem(async (tx) => (await find(tx, tenant)).map((p) => p.id));

  it("retires the empty twin of a PAN client in the same family, despite family bookkeeping and a queued notification", async () => {
    expect(await found()).toContain(ids.twin);
  });

  it("keeps an empty placeholder in a family that holds no PAN client of that name", async () => {
    expect(await found()).not.toContain(ids.noTwin);
  });

  it("keeps one a person edited", async () => {
    expect(await found()).not.toContain(ids.edited);
  });

  it("retires a plain placeholder nothing refers to", async () => {
    expect(await found()).toContain(ids.plain);
  });
});
