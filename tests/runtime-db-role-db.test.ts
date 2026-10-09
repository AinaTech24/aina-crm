/**
 * Final security patch, P0 — no privileged database fallback for the runtime
 * (src/db/runtime-role.ts, src/db/client.ts, the worker entry point and the
 * web server's instrumentation hook), against a real Postgres.
 *
 * Real roles are created for each case (restricted, a second restricted role
 * for "web and worker with different credentials", BYPASSRLS, table owner,
 * member of an owner, CREATEROLE, TRIGGER on a financial table; the superuser
 * is the database's own). The startup checks run as separate processes with
 * NODE_ENV=production, exactly as the web server and the worker start.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describeUrl, resolveDatabaseConnection, roleProblems } from "@/db/runtime-role";

const TEST_DB = process.env.TEST_DATABASE_URL;
const ADMIN_DB = process.env.ADMIN_DATABASE_URL;

describe("connection policy (pure)", () => {
  const app = "postgres://app_role:s3cret@db.internal:5432/mfd";
  const master = "postgres://migrator:m4ster@db.internal:5432/mfd";
  it("production: APP_DATABASE_URL is required; there is no fallback to DATABASE_URL", () => {
    const d = resolveDatabaseConnection({ NODE_ENV: "production", DATABASE_URL: master });
    expect(d.ok).toBe(false);
    if (!d.ok) { expect(d.reason).toMatch(/APP_DATABASE_URL is not set/); expect(d.reason).not.toMatch(/m4ster/); expect(d.reason).toMatch(/migrator@db\.internal/); }
    for (const marker of ["APP_ENV", "ENVIRONMENT", "VERCEL_ENV", "RAILWAY_ENVIRONMENT"]) {
      expect(resolveDatabaseConnection({ [marker]: "production", DATABASE_URL: master }).ok).toBe(false);
    }
    expect(resolveDatabaseConnection({ NODE_ENV: "production", DATABASE_URL: master, APP_DATABASE_URL: app })).toMatchObject({ ok: true, url: app, source: "app" });
  });
  it("tooling declares itself; development keeps a loud fallback; a build never connects as runtime", () => {
    expect(resolveDatabaseConnection({ NODE_ENV: "production", DATABASE_URL: master, DB_TOOLING: "1" })).toMatchObject({ ok: true, url: master, source: "tooling" });
    expect(resolveDatabaseConnection({ NODE_ENV: "development", DATABASE_URL: master })).toMatchObject({ ok: true, source: "development_fallback", warning: expect.stringMatching(/outside production only/) });
    expect(resolveDatabaseConnection({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build", DATABASE_URL: master }).ok).toBe(true);
  });
  it("diagnostics never print a password", () => {
    expect(describeUrl(app)).toBe("app_role@db.internal:5432/mfd");
    expect(roleProblems({ role: "x", sessionUser: "x", database: "d", superuser: false, bypassRls: false, createRole: false, ownedObjects: 0, ownsDatabase: false,
      privilegedMemberships: [], canSetReplicationRole: false, protectedTableGrants: [] })).toEqual([]);
  });
});

describe.skipIf(!TEST_DB || !ADMIN_DB)("runtime database role (DB)", () => {
  const sfx = randomUUID().slice(0, 8).replace(/-/g, "");
  const pw = randomBytes(12).toString("hex");
  const R = { ok: `rt_ok_${sfx}`, ok2: `rt_ok2_${sfx}`, bypass: `rt_bypass_${sfx}`, owner: `rt_owner_${sfx}`, member: `rt_member_${sfx}`, createrole: `rt_crole_${sfx}`, trigger: `rt_trig_${sfx}` };
  const dbName = new URL(TEST_DB!).pathname.slice(1);
  const adminUrl = ADMIN_DB!.replace(/\/[^/]+$/, "/" + dbName);
  const urlFor = (role: string) => { const u = new URL(TEST_DB!); u.username = role; u.password = pw; return u.toString(); };
  const firmA = randomUUID(), firmB = randomUUID();
  let admin: import("pg").Client;

  /** Run code as a separate process with NODE_ENV=production; returns exit status and output. */
  const runProd = (code: string, env: Record<string, string | undefined>) => {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(APP_DATABASE_URL|DATABASE_URL|DB_TOOLING|ALLOW_SUPERUSER_DB|TEST_|ADMIN_)/.test(k)) base[k] = v;
    const full: Record<string, string> = { ...base, NODE_ENV: "production", DB_QUIET: "1" };
    for (const [k, v] of Object.entries(env)) if (v !== undefined) full[k] = v;
    const r = spawnSync("npx", ["tsx", "-e", code], { env: full as NodeJS.ProcessEnv, encoding: "utf8", timeout: 90_000 });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  const WORKER_CHECK = `import("./src/db/client").then((m) => (m.assertRuntimeDatabase ?? m.default.assertRuntimeDatabase)("worker")).then((r) => { console.log("STARTED as " + r.role); process.exit(0); }, (e) => { console.error("REFUSED " + e.message); process.exit(1); })`;
  const WEB_CHECK = `import("./src/instrumentation-node").then((m) => (m.checkWebDatabase ?? m.default.checkWebDatabase)()).then(() => { console.log("WEB STARTED"); process.exit(0); })`;

  beforeAll(async () => {
    const pg = await import("pg");
    admin = new pg.default.Client({ connectionString: adminUrl });
    await admin.connect();
    for (const r of Object.values(R)) await admin.query(`CREATE ROLE ${r} LOGIN PASSWORD '${pw}' NOSUPERUSER`);
    for (const r of Object.values(R)) {
      await admin.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${r}`);
      await admin.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`);
      await admin.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${r}`);
    }
    await admin.query(`ALTER ROLE ${R.bypass} BYPASSRLS`);
    await admin.query(`ALTER ROLE ${R.createrole} CREATEROLE`);
    await admin.query(`CREATE TABLE public.rt_owned_${sfx} (id int)`);
    await admin.query(`ALTER TABLE public.rt_owned_${sfx} OWNER TO ${R.owner}`);
    await admin.query(`GRANT ${R.owner} TO ${R.member}`);
    await admin.query(`GRANT TRIGGER ON public.transactions TO ${R.trigger}`);
    await admin.query(`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES ($1, 'Role A', 'Role A', $3), ($2, 'Role B', 'Role B', $4)`, [firmA, firmB, `ARN-RA${sfx}`, `ARN-RB${sfx}`]);
    await admin.query(`INSERT INTO investors (tenant_id, name) VALUES ($1, 'Client of A'), ($2, 'Client of B')`, [firmA, firmB]);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    const q = (s: string, p: unknown[] = []) => admin.query(s, p).catch(() => {});
    await q(`DELETE FROM investors WHERE tenant_id IN ($1, $2)`, [firmA, firmB]);
    await q(`DELETE FROM tenants WHERE id IN ($1, $2)`, [firmA, firmB]);
    await q(`DROP TABLE IF EXISTS public.rt_owned_${sfx}`);
    for (const r of Object.values(R)) { await q(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`); await q(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${r}`); await q(`REVOKE ALL ON SCHEMA public FROM ${r}`); await q(`REVOKE ALL ON DATABASE "${dbName}" FROM ${r}`); }
    for (const r of [R.member, ...Object.values(R)]) await q(`DROP ROLE IF EXISTS ${r}`);
    await admin.end();
  });

  const inspectAs = async (url: string) => {
    const pg = await import("pg");
    const { inspectRole } = await import("@/db/runtime-role");
    const c = new pg.default.Client({ connectionString: url });
    await c.connect();
    try { return roleProblems(await inspectRole((t, p) => c.query(t, p))); } finally { await c.end(); }
  };

  it("inspection: the restricted roles pass; every privileged shape is named", async () => {
    expect(await inspectAs(urlFor(R.ok))).toEqual([]);
    expect(await inspectAs(urlFor(R.ok2))).toEqual([]);
    expect((await inspectAs(adminUrl)).join(" ")).toMatch(/SUPERUSER/);
    expect((await inspectAs(urlFor(R.bypass))).join(" ")).toMatch(/BYPASSRLS/);
    expect((await inspectAs(urlFor(R.owner))).join(" ")).toMatch(/owns 1 object/);
    const member = (await inspectAs(urlFor(R.member))).join(" ");
    expect(member).toMatch(/can assume privileged role\(s\): rt_owner_/);
    expect(member).toMatch(/owns 1 object\(s\) in schema public \(directly or through membership\)/);
    expect((await inspectAs(urlFor(R.createrole))).join(" ")).toMatch(/CREATEROLE/);
    expect((await inspectAs(urlFor(R.trigger))).join(" ")).toMatch(/transactions:TRIGGER/);
  });

  it("worker startup (production): missing APP_DATABASE_URL, superuser, BYPASSRLS, owner, member-of-owner and tooling all refuse; the restricted role starts", () => {
    const missing = runProd(WORKER_CHECK, { DATABASE_URL: adminUrl });
    expect(missing.status).not.toBe(0);
    expect(missing.out).toMatch(/APP_DATABASE_URL is not set/);
    expect(missing.out).not.toContain("postgres:postgres"); // never the password
    for (const [label, url, why] of [
      ["superuser", adminUrl, /SUPERUSER/], ["bypassrls", urlFor(R.bypass), /BYPASSRLS/], ["owner", urlFor(R.owner), /owns 1 object/],
      ["member", urlFor(R.member), /can assume privileged role/], ["createrole", urlFor(R.createrole), /CREATEROLE/],
    ] as const) {
      const r = runProd(WORKER_CHECK, { APP_DATABASE_URL: url, DATABASE_URL: adminUrl });
      expect(r.status, label).toBe(1);
      // Either the awaited startup check or the load-time check refuses first; both exit 1 with the reason.
      expect(r.out, label).toMatch(/REFUSED \[db\] worker refuses to start|\[db\] SECURITY: connected to .*\n[\s\S]*Refusing to run in production/);
      expect(r.out, label).toMatch(why);
      expect(r.out, label).not.toContain(pw);
    }
    const tooling = runProd(WORKER_CHECK, { APP_DATABASE_URL: urlFor(R.ok), DB_TOOLING: "1" });
    expect(tooling.status).toBe(1);
    expect(tooling.out).toMatch(/DB_TOOLING=1 is set/);
    const ok = runProd(WORKER_CHECK, { APP_DATABASE_URL: urlFor(R.ok), DATABASE_URL: adminUrl });
    expect(ok.out).toMatch(new RegExp(`STARTED as ${R.ok}`));
    expect(ok.status).toBe(0);
  }, 600_000);

  it("the real worker entry point refuses to start any job under a privileged role", () => {
    const full: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(APP_DATABASE_URL|DATABASE_URL|TEST_|ADMIN_)/.test(k)) full[k] = v;
    const r = spawnSync("npx", ["tsx", "src/workers/index.ts"], {
      env: { ...full, NODE_ENV: "production", DB_QUIET: "1", APP_DATABASE_URL: urlFor(R.owner), DATABASE_URL: adminUrl, REDIS_URL: "redis://127.0.0.1:1" },
      encoding: "utf8", timeout: 120_000,
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/\[worker\] refusing to start: \[db\] worker refuses to start|Refusing to run in production/);
    expect(`${r.stdout}${r.stderr}`).toMatch(/owns 1 object/);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/Worker process up/);
  }, 180_000);

  it("web and worker with different credentials: each is checked on its own; web restricted + worker privileged → only the worker refuses", () => {
    const web = runProd(WEB_CHECK, { APP_DATABASE_URL: urlFor(R.ok) });
    expect(web.status).toBe(0);
    expect(web.out).toMatch(/WEB STARTED/);
    const worker = runProd(WORKER_CHECK, { APP_DATABASE_URL: urlFor(R.ok2) });
    expect(worker.status).toBe(0);
    const badWorker = runProd(WORKER_CHECK, { APP_DATABASE_URL: urlFor(R.bypass) });
    expect(badWorker.status).toBe(1);
    const badWeb = runProd(WEB_CHECK, { APP_DATABASE_URL: urlFor(R.owner) });
    expect(badWeb.status).toBe(1);
    expect(badWeb.out).toMatch(/\[web\] refusing to start|Refusing to run in production/);
    expect(badWeb.out).toMatch(/owns 1 object/);
    const noAppWeb = runProd(WEB_CHECK, { DATABASE_URL: adminUrl });
    expect(noAppWeb.status).toBe(1);
    expect(noAppWeb.out).toMatch(/APP_DATABASE_URL is not set/);
  }, 600_000);

  it("financial posting refuses an owner / member / BYPASSRLS role inside the transaction, whatever the process said at startup", async () => {
    const pg = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const gate = await import("@/lib/rta/posting/gate");
    const env = { ...process.env, RTA_POSTING_MODE: "development", RTA_POSTING_DATABASE: dbName, NODE_ENV: "test" };
    const attempt = async (url: string) => {
      const c = new pg.default.Client({ connectionString: url });
      await c.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [firmA]);
        await gate.assertPostingAllowed(drizzle(c) as any, firmA, env as NodeJS.ProcessEnv);
        return "allowed";
      } catch (e: any) { return String(e?.message ?? e); } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
    };
    for (const role of [R.owner, R.member, R.bypass, R.trigger]) expect(await attempt(urlFor(role))).toMatch(/connected database role may not post/);
    expect(await attempt(urlFor(R.ok))).not.toMatch(/connected database role may not post/);
  });

  it("tenant isolation holds for the restricted runtime role after startup", async () => {
    const pg = await import("pg");
    const c = new pg.default.Client({ connectionString: urlFor(R.ok) });
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [firmA]);
      const seen = await c.query(`SELECT tenant_id::text FROM investors WHERE tenant_id IN ($1, $2)`, [firmA, firmB]);
      expect(seen.rows.map((r: any) => r.tenant_id)).toEqual([firmA]);
      await c.query("ROLLBACK");
      const none = await c.query(`SELECT count(*)::int AS n FROM investors WHERE tenant_id IN ($1, $2)`, [firmA, firmB]);
      expect(none.rows[0].n).toBe(0); // no tenant set → nothing
      expect(await c.query(`ALTER TABLE transactions DISABLE TRIGGER ALL`).then(() => "altered", (e) => String(e.message))).toMatch(/must be owner/);
      expect(await c.query(`SET session_replication_role = replica`).then(() => "set", (e) => String(e.message))).toMatch(/permission denied/);
    } finally { await c.end(); }
  });
});
