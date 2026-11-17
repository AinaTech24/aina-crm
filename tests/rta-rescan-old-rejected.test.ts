/**
 * Files refused by the OLD opener are retried with the saved passwords — without
 * anyone saving a password — and the ones the saved passwords open are re-queued.
 *
 * Two archives are stored as "rejected": one whose real password ends in a space
 * (the old code saved it trimmed), one ZipCrypto archive whose header byte zip.js
 * does not accept. A third, with a password the firm does not hold, stays rejected.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { deflateRawSync } from "node:zlib";
import { crc32 } from "@/lib/rta/zipcrypto";

const added: Array<{ name: string; data: any }> = [];
vi.mock("@/workers/queues", () => ({
  RTA_BACKGROUND_PRIORITY: 100,
  Q: { rtaImport: () => ({ add: async (name: string, data: any) => { added.push({ name, data }); } }) },
}));

const TEST_DB = process.env.TEST_DATABASE_URL;
const TEXT = "a|b\n1|2\n".repeat(20);

async function aesZip(password: string): Promise<Uint8Array> {
  const w = new ZipWriter(new BlobWriter("application/zip"), { password, useWebWorkers: false });
  await w.add("WBR2.txt", new TextReader(TEXT));
  return new Uint8Array(await (await w.close()).arrayBuffer());
}

// A ZipCrypto zip whose header's check byte is 0x00 (not what zip.js expects).
function oddZipCrypto(password: string): Uint8Array {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const cb = (crc: number, b: number) => ((T[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0);
  const plain = new TextEncoder().encode(TEXT);
  const crc = crc32(plain);
  const body = new Uint8Array(deflateRawSync(plain));
  const header = new Uint8Array(12).fill(9); header[11] = 0x00;
  let k0 = 305419896, k1 = 591751049, k2 = 878082192;
  const upd = (b: number) => { k0 = cb(k0, b); k1 = (k1 + (k0 & 0xff)) >>> 0; k1 = (Math.imul(k1, 134775813) + 1) >>> 0; k2 = cb(k2, k1 >>> 24); };
  const sb = () => { const t = (k2 | 2) & 0xffff; return ((t * (t ^ 1)) >>> 8) & 0xff; };
  for (const ch of password) upd(ch.charCodeAt(0) & 0xff);
  const all = new Uint8Array([...header, ...body]);
  const data = new Uint8Array(all.length);
  for (let i = 0; i < all.length; i++) { const c = all[i] ^ sb(); upd(all[i]); data[i] = c; }
  const nm = new TextEncoder().encode("WBR2.txt");
  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const local = [...u32(0x04034b50), ...u16(20), ...u16(1), ...u16(8), ...u16(0x6000), ...u16(0x5a21), ...u32(crc), ...u32(data.length), ...u32(plain.length), ...u16(nm.length), ...u16(0), ...nm, ...data];
  const central = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(1), ...u16(8), ...u16(0x6000), ...u16(0x5a21), ...u32(crc), ...u32(data.length), ...u32(plain.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...nm];
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1), ...u32(central.length), ...u32(local.length), ...u16(0)];
  return new Uint8Array([...local, ...central, ...eocd]);
}

describe.skipIf(!TEST_DB)("rescan of files the old opener refused", () => {
  const tenant = randomUUID();
  const ids = { space: randomUUID(), odd: randomUUID(), foreign: randomUUID() };
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  const q = (t: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(t));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!; process.env.APP_DATABASE_URL = ""; process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0".repeat(64);
    delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_SECRET_ACCESS_KEY;
    ({ withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    const { putObject } = await import("@/lib/storage/s3");
    const cfg = await import("@/lib/rta/mailback-config");
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Rescan', 'Rescan', ${"ARN-RS-" + tenant.slice(0, 6)})`);
    // The firm saved "Secret#1" — trimmed — and "Abc@123".
    await withSystem(async (tx) => { await cfg.saveMailbackPasswords(tx, tenant, { camsPasswords: [{ password: "Secret#1" }, { password: "Abc@123" }] }); });
    const files: Array<[string, string, Uint8Array]> = [
      [ids.space, "space.zip", await aesZip("Secret#1 ")],   // really ends in a space
      [ids.odd, "odd.zip", oddZipCrypto("Abc@123")],        // right password, odd check byte
      [ids.foreign, "foreign.zip", await aesZip("NotOurs!")],
    ];
    for (const [id, name, bytes] of files) {
      const key = `tenants/${tenant}/rta/${name}`;
      await putObject(key, Buffer.from(bytes), "application/zip");
      await q(sql`INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status, remarks)
                  VALUES (${id}::uuid, ${tenant}::uuid, 'cams', 'daily_transaction_feed', current_date, current_date, ${name}, ${key}, 'rejected', 'Not opened — the only password tried')`);
    }
  }, 60_000);

  afterAll(async () => {
    if (!withSystem) return;
    for (const t of ["rta_file_imports", "tenant_integrations"]) await q(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${tenant}'`)).catch(() => {});
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`).catch(() => {});
    const { rmSync } = await import("node:fs");
    rmSync(`node-local/uploads/tenants/${tenant}`, { recursive: true, force: true });
  });

  it("finds the firm among those with refused ZIPs", async () => {
    const { enqueueRescansForAllFirms } = await import("@/workers/rta-import-worker");
    added.length = 0;
    const r = await enqueueRescansForAllFirms();
    expect(r.firms).toBeGreaterThanOrEqual(1);
    expect(added.some((a) => a.name === "rescan" && a.data.tenantId === tenant)).toBe(true);
  });

  it("re-queues the two the saved passwords open, and leaves the foreign one rejected", async () => {
    const { runRejectedRescanJob } = await import("@/workers/rta-import-worker");
    added.length = 0;
    const r = await runRejectedRescanJob({ mode: "rescan", tenantId: tenant, source: "cams" });
    expect(r.requeued).toBe(2);
    expect(r.stillLocked).toBe(1);
    const st = Object.fromEntries(((await q(sql`SELECT id, status FROM rta_file_imports WHERE tenant_id = ${tenant}::uuid`)).rows as any[]).map((x) => [x.id, x.status]));
    expect(st[ids.space]).toBe("uploaded");
    expect(st[ids.odd]).toBe("uploaded");
    expect(st[ids.foreign]).toBe("rejected");
    expect(added.filter((a) => a.name === "import" || a.name === "rich-import").length).toBe(2);
  });
});
