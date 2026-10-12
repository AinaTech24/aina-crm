/**
 * rta_file_imports tenant isolation — BEHAVIORAL, against a migrated Postgres
 * on the NON-superuser app role (TEST_DATABASE_URL, e.g. mfd_app), so RLS
 * actually applies. Skipped without TEST_DATABASE_URL (pattern:
 * tests/rls-isolation.test.ts).
 *
 *   • withTenant(B) cannot read, update or delete tenant A's import by id;
 *   • through the API, firm B's owner gets 404 for A's import id, while A's
 *     owner gets it — with the synthetic PAN in its stored error MASKED.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));

describe.skipIf(!TEST_DB)("rta_file_imports tenant isolation (behavioral)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let GET: typeof import("@/app/api/rta-imports/[id]/route").GET;
  let NextRequestCtor: typeof import("next/server").NextRequest;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const importA = randomUUID();
  const PAN = "ABCPE1234F"; // synthetic

  const ownerOf = (tenantId: string) => ({ tenantId, userId: randomUUID(), roles: ["owner"], permissions: [] });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    ({ GET } = await import("@/app/api/rta-imports/[id]/route"));
    ({ NextRequest: NextRequestCtor } = await import("next/server"));

    await withSystem(async (tx) => {
      await tx.execute(sql`
        INSERT INTO tenants (id, legal_name, display_name, arn) VALUES
          (${tenantA}::uuid, 'RTA RLS Test A', 'RTA RLS Test A', ${`ARN-RA-${tenantA.slice(0, 6)}`}),
          (${tenantB}::uuid, 'RTA RLS Test B', 'RTA RLS Test B', ${`ARN-RB-${tenantB.slice(0, 6)}`})
      `);
      await tx.execute(sql`
        INSERT INTO rta_file_imports (id, tenant_id, source, kind, period_start, period_end, file_name, file_key, status, errors, remarks)
        VALUES (${importA}::uuid, ${tenantA}::uuid, 'cams', 'daily_transaction_feed', CURRENT_DATE, CURRENT_DATE,
                'synthetic_WBR2.csv', ${`tenants/${tenantA}/rta/1-synthetic_WBR2.csv`}, 'partial',
                ${JSON.stringify([{ row: 2, reason: `PAN ${PAN} not in client master` }])}::jsonb,
                ${`Row for ${PAN} skipped`})
      `);
    });
  });

  afterAll(async () => {
    try {
      await withSystem(async (tx) => {
        await tx.execute(sql`DELETE FROM rta_file_imports WHERE tenant_id IN (${tenantA}::uuid, ${tenantB}::uuid)`);
        await tx.execute(sql`DELETE FROM tenants WHERE id IN (${tenantA}::uuid, ${tenantB}::uuid)`);
      });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("tenant B cannot SELECT tenant A's import by id", async () => {
    const rows = await withTenant(tenantB, (tx) => tx.execute(sql`SELECT id FROM rta_file_imports WHERE id = ${importA}::uuid`));
    expect(rows.rows.length).toBe(0);
    const own = await withTenant(tenantA, (tx) => tx.execute(sql`SELECT id FROM rta_file_imports WHERE id = ${importA}::uuid`));
    expect(own.rows.length).toBe(1);
  });

  it("tenant B cannot UPDATE or DELETE tenant A's import", async () => {
    const upd = await withTenant(tenantB, (tx) =>
      tx.execute(sql`UPDATE rta_file_imports SET remarks = 'tampered' WHERE id = ${importA}::uuid RETURNING id`)
    );
    expect(upd.rows.length).toBe(0);
    const del = await withTenant(tenantB, (tx) => tx.execute(sql`DELETE FROM rta_file_imports WHERE id = ${importA}::uuid RETURNING id`));
    expect(del.rows.length).toBe(0);
  });

  it("the API answers 404 to firm B's owner and the masked row to firm A's owner", async () => {
    const req = () => new NextRequestCtor(`https://crm.test/api/rta-imports/${importA}`);
    const params = { params: Promise.resolve({ id: importA }) };

    mocks.session.mockResolvedValue(ownerOf(tenantB));
    expect((await GET(req(), params)).status).toBe(404);

    mocks.session.mockResolvedValue(ownerOf(tenantA));
    const res = await GET(req(), { params: Promise.resolve({ id: importA }) });
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(PAN);
    expect(text).toContain("ABC••••4F");
  });
});
