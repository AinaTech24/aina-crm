/**
 * Which database role the RUNTIME (web and worker) may use — and proof of it
 * (final security patch, P0).
 *
 * Two rules:
 *   1. Connection. In production the web and worker processes connect ONLY
 *      with APP_DATABASE_URL — the restricted application role. There is no
 *      fallback to DATABASE_URL (the migration role): a missing
 *      APP_DATABASE_URL refuses to start. Migration tooling declares itself
 *      with DB_TOOLING=1 and may use DATABASE_URL; the runtime refuses to start
 *      with DB_TOOLING set. Outside production (development, tests, isolated
 *      rehearsal databases) the old fallback stays, loudly.
 *   2. Role. The connected role must not be able to bypass tenant isolation
 *      or the financial guards: no SUPERUSER, no BYPASSRLS, no CREATEROLE, not
 *      the owner (directly or through membership) of any object in `public` or
 *      of the database, no membership that reaches such a role, no right to
 *      set session_replication_role (which skips triggers), and no TRIGGER /
 *      TRUNCATE / REFERENCES on the protected financial and control tables.
 *      Checked when the web and worker processes start, and again inside
 *      every posting transaction (lib/rta/posting/gate.ts).
 *
 * Diagnostics name the role, the host and the database — never a password.
 */

export type DbEnv = Record<string, string | undefined>;

export function isProductionEnv(env: DbEnv): boolean {
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") return true;
  return ["VERCEL_ENV", "RAILWAY_ENVIRONMENT", "APP_ENV", "ENVIRONMENT"].some((k) => (env[k] ?? "").toLowerCase() === "production");
}
export const isBuildPhase = (env: DbEnv) => env.NEXT_PHASE === "phase-production-build";

/** "role@host/db" from a connection URL — never the password. */
export function describeUrl(url: string | undefined): string {
  if (!url) return "(unset)";
  try {
    const u = new URL(url);
    return `${decodeURIComponent(u.username) || "(no user)"}@${u.hostname || "(socket)"}${u.port ? `:${u.port}` : ""}${u.pathname || ""}`;
  } catch {
    return "(unparseable URL)";
  }
}

export type ConnectionDecision =
  | { ok: true; url: string; source: "app" | "tooling" | "development_fallback"; warning?: string }
  | { ok: false; reason: string };

/** Pure: which URL this process may connect with. */
export function resolveDatabaseConnection(env: DbEnv): ConnectionDecision {
  const app = env.APP_DATABASE_URL || "";
  const master = env.DATABASE_URL || "";
  if (env.DB_TOOLING === "1") {
    const url = app || master;
    if (!url) return { ok: false, reason: "DB_TOOLING=1 but neither APP_DATABASE_URL nor DATABASE_URL is set" };
    return { ok: true, url, source: "tooling" };
  }
  if (app) return { ok: true, url: app, source: "app" };
  if (isProductionEnv(env) && !isBuildPhase(env)) {
    return {
      ok: false,
      reason: "APP_DATABASE_URL is not set. In production the web and worker processes connect only as the restricted application role; "
        + `they never fall back to DATABASE_URL (${describeUrl(master)}, the migration role). Provision the role (npm run db:provision-app-role) `
        + "and set APP_DATABASE_URL on this host.",
    };
  }
  if (!master) return { ok: false, reason: "DATABASE_URL is not set" };
  return {
    ok: true, url: master, source: "development_fallback",
    warning: `APP_DATABASE_URL is not set — using DATABASE_URL (${describeUrl(master)}). Allowed outside production only.`,
  };
}

/** The financial and control tables a runtime role must never own, truncate or put triggers on. */
export const PROTECTED_TABLES = [
  "transactions", "sip_rejections", "sips", "folios", "investors", "audit_log", "user_sessions", "users",
  "rta_posted_transactions", "rta_pipeline_activations", "rta_posting_controls", "rta_posting_control_events",
  "rta_posting_reversals", "rta_control_requests", "rta_file_imports", "rta_reconciliation_runs", "ops_alerts",
];

export type RoleReport = {
  role: string; sessionUser: string; database: string;
  superuser: boolean; bypassRls: boolean; createRole: boolean;
  ownedObjects: number; ownsDatabase: boolean;
  privilegedMemberships: string[];
  canSetReplicationRole: boolean;
  protectedTableGrants: string[];
};

/** One read-only query; works as any role. */
export const ROLE_REPORT_SQL = `
  SELECT current_user AS role, session_user AS session_user, current_database() AS database,
         r.rolsuper AS superuser, r.rolbypassrls AS bypass_rls, r.rolcreaterole AS create_role,
         (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND pg_has_role(current_user, c.relowner, 'MEMBER'))::int
       + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND pg_has_role(current_user, p.proowner, 'MEMBER'))::int AS owned_objects,
         pg_has_role(current_user, (SELECT d.datdba FROM pg_database d WHERE d.datname = current_database()), 'MEMBER') AS owns_database,
         ARRAY(SELECT g.rolname::text FROM pg_roles g
                WHERE g.oid <> r.oid AND pg_has_role(current_user, g.oid, 'MEMBER')
                  AND (g.rolsuper OR g.rolbypassrls OR g.rolcreaterole
                       OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relowner = g.oid)
                       OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datname = current_database() AND d.datdba = g.oid))
                ORDER BY 1) AS privileged_memberships,
         has_parameter_privilege(current_user, 'session_replication_role', 'SET') AS can_set_replication_role,
         ARRAY(SELECT t || ':' || p FROM unnest($1::text[]) AS t, unnest(ARRAY['TRIGGER', 'TRUNCATE', 'REFERENCES']) AS p
                WHERE to_regclass('public.' || t) IS NOT NULL AND has_table_privilege(current_user, ('public.' || t)::regclass, p)
                ORDER BY 1) AS protected_table_grants
    FROM pg_roles r WHERE r.rolname = current_user`;

export function toRoleReport(row: any): RoleReport {
  return {
    role: String(row.role), sessionUser: String(row.session_user), database: String(row.database),
    superuser: !!row.superuser, bypassRls: !!row.bypass_rls, createRole: !!row.create_role,
    ownedObjects: Number(row.owned_objects ?? 0), ownsDatabase: !!row.owns_database,
    privilegedMemberships: Array.isArray(row.privileged_memberships) ? row.privileged_memberships.map(String) : [],
    canSetReplicationRole: !!row.can_set_replication_role,
    protectedTableGrants: Array.isArray(row.protected_table_grants) ? row.protected_table_grants.map(String) : [],
  };
}

/** Pure: why this role may not run the application (empty = restricted, as required). */
export function roleProblems(r: RoleReport): string[] {
  const out: string[] = [];
  if (r.superuser || r.bypassRls) out.push(`role '${r.role}' ${r.superuser ? "is a SUPERUSER" : "has BYPASSRLS"}: it bypasses row-level security`);
  if (r.createRole) out.push(`role '${r.role}' has CREATEROLE: it can grant itself other roles`);
  if (r.ownsDatabase) out.push(`role '${r.role}' owns database '${r.database}' (directly or through membership)`);
  if (r.ownedObjects > 0) out.push(`role '${r.role}' owns ${r.ownedObjects} object(s) in schema public (directly or through membership): an owner can disable triggers and row-level security`);
  if (r.privilegedMemberships.length) out.push(`role '${r.role}' can assume privileged role(s): ${r.privilegedMemberships.join(", ")}`);
  if (r.canSetReplicationRole) out.push(`role '${r.role}' may set session_replication_role, which skips the guard triggers`);
  if (r.protectedTableGrants.length) out.push(`role '${r.role}' holds dangerous privileges on protected tables: ${r.protectedTableGrants.join(", ")}`);
  return out;
}

/** Inspect the role behind any query function (a pool, a client or a transaction). */
export async function inspectRole(query: (text: string, params: unknown[]) => Promise<{ rows: any[] }>): Promise<RoleReport> {
  const r = await query(ROLE_REPORT_SQL, [PROTECTED_TABLES]);
  return toRoleReport(r.rows[0]);
}

export class RuntimeDatabaseError extends Error {
  name = "RuntimeDatabaseError";
  constructor(public kind: string, public problems: string[], public target: string) {
    super(`[db] ${kind} refuses to start against ${target}:\n  - ${problems.join("\n  - ")}`);
  }
}
