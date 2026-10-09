/**
 * The posting gate — FAIL-CLOSED. Financial posting from staging
 * (lib/rta/posting/*) runs only when every check below passes; anything
 * missing, malformed or ambiguous refuses. There is no override flag.
 *
 * RTA_POSTING_MODE picks the KIND of environment:
 *
 *   (unset / anything else)  no posting at all.
 *   development  (Phase 3F) a local database only: the database URL must be
 *                loopback / a socket and the connected server must agree.
 *   controlled   (Phase 3G) a real server is allowed, but posting is then
 *                decided per firm, in the database, by operators: the firm's
 *                current activation must be validate_first with posting
 *                enabled (two people), and the kill switch released.
 *
 * Process checks (every call, nothing cached):
 *   - not production by NODE_ENV / hosting markers — development kind only
 *     (controlled exists precisely to run where those say production);
 *   - RTA_POSTING_DATABASE names the one database posting may write to;
 *   - RTA_POSTING_HALT is not "1" (a process-level kill switch);
 *   - development kind: every database URL is on this machine.
 *
 * Database checks, INSIDE the posting transaction (same transaction as the
 * writes, so a change takes effect for the very next batch):
 *   - current_database() = RTA_POSTING_DATABASE;
 *   - development kind: the server address is loopback (or a socket);
 *   - the connected role is neither a superuser nor BYPASSRLS — posting
 *     always runs under row-level security;
 *   - app.tenant_id is the firm being posted (RLS scoping is live);
 *   - the kill switch: 'global' and the firm's row released (read FOR SHARE,
 *     so halting waits for this batch and stops the next);
 *   - controlled kind: the firm's current activation (read FOR SHARE) is
 *     validate_first with posting_enabled.
 */

export class PostingGateError extends Error {
  constructor(public reasons: string[]) {
    super(`RTA posting is disabled — ${reasons.join("; ")}. Nothing was written.`);
    this.name = "PostingGateError";
  }
}

export type PostingKind = "development" | "controlled";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function dbHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // postgres://user@/db?host=/var/run/postgresql — a unix socket.
    if (!u.hostname && (u.searchParams.get("host") ?? "").startsWith("/")) return "unix-socket";
    return u.hostname || null;
  } catch {
    return null;
  }
}

export function postingKind(env: NodeJS.ProcessEnv = process.env): PostingKind | null {
  const m = env.RTA_POSTING_MODE ?? "";
  return m === "development" || m === "controlled" ? m : null;
}

/** The process-level checks. `allowed` means posting MAY run; the database checks still decide. */
export function postingGateEnv(env: NodeJS.ProcessEnv = process.env): { allowed: boolean; reasons: string[]; kind: PostingKind | null } {
  const reasons: string[] = [];
  const kind = postingKind(env);
  if (!kind) reasons.push(`RTA_POSTING_MODE is "${env.RTA_POSTING_MODE ?? ""}", not "development" or "controlled"`);
  if (kind !== "controlled") {
    if ((env.NODE_ENV ?? "").toLowerCase() === "production") reasons.push("NODE_ENV is production");
    for (const k of ["VERCEL_ENV", "RAILWAY_ENVIRONMENT", "APP_ENV", "ENVIRONMENT"]) {
      if ((env[k] ?? "").toLowerCase() === "production") reasons.push(`${k} is production`);
    }
  }
  if (env.RTA_POSTING_HALT === "1") reasons.push("RTA_POSTING_HALT=1 (process kill switch)");
  if (!env.RTA_POSTING_DATABASE) reasons.push("RTA_POSTING_DATABASE is not set");
  const urls = [env.APP_DATABASE_URL, env.DATABASE_URL].filter((u): u is string => !!u);
  if (!urls.length) reasons.push("no database URL is configured");
  for (const u of urls) {
    const h = dbHost(u);
    if (!h) reasons.push("a database URL cannot be read");
    else if (kind !== "controlled" && h !== "unix-socket" && !LOOPBACK.has(h)) reasons.push("a database URL is not on this machine");
  }
  return { allowed: reasons.length === 0, reasons, kind };
}

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

/**
 * Throws PostingGateError unless the environment AND the connected database
 * AND the firm's controls pass. Call first inside the posting transaction.
 */
export async function assertPostingAllowed(
  tx: Tx, tenantId: string, env: NodeJS.ProcessEnv = process.env, opts: { rta?: string | null; reportCode?: string | null } = {},
): Promise<{ registrars: string[] | null; reportCodes: string[] | null }> {
  const g = postingGateEnv(env);
  if (!g.allowed) throw new PostingGateError(g.reasons);
  const { sql } = await import("drizzle-orm");
  const r = (await tx.execute(sql`
    SELECT current_database() AS db, host(inet_server_addr()) AS addr, current_setting('app.tenant_id', true) AS tenant,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass
  `)).rows[0] as { db: string; addr: string | null; tenant: string | null; su: boolean; bypass: boolean };
  const reasons: string[] = [];
  if (r.db !== env.RTA_POSTING_DATABASE) reasons.push("the connected database is not RTA_POSTING_DATABASE");
  if (g.kind === "development" && r.addr !== null && !["127.0.0.1", "::1"].includes(r.addr)) reasons.push("the connected database server is not on this machine");
  if (r.su || r.bypass) reasons.push("the connected database role bypasses row-level security — posting runs only as the restricted application role");
  if ((r.tenant ?? "") !== tenantId) reasons.push("the transaction is not scoped to this firm");
  if (reasons.length) throw new PostingGateError(reasons);
  // Loaded here, not at module top: the env-only checks above are imported by
  // tooling that has no database (staging/config → source readers).
  const { currentActivation, haltState, registrarCovered, reportCovered } = await import("./controls");
  const halt = await haltState(tx, tenantId, { lock: true });
  if (halt.halted) throw new PostingGateError(halt.reasons);
  const a = await currentActivation(tx, tenantId, { lock: g.kind === "controlled" });
  if (g.kind === "controlled") {
    if (!a || a.mode !== "validate_first") throw new PostingGateError([`this firm is not activated for validate-first (current mode: ${a?.mode ?? "off"})`]);
    if (!a.postingEnabled) throw new PostingGateError(["this firm's activation does not enable posting"]);
    if (!a.registrars?.length) throw new PostingGateError(["this firm's activation names no registrars — record a new activation that states them"]);
    if (!a.reportCodes?.length) throw new PostingGateError(["this firm's activation names no report types — record a new activation that states them"]);
  }
  // The registrar scope (0242): a file, held transaction or registration of a
  // registrar the activation does not name is never posted.
  if (opts.rta !== undefined && !registrarCovered(a, opts.rta)) throw new PostingGateError([registrarOutOfScope(a?.registrars ?? null, opts.rta)]);
  // The report-type scope (0243): MFSD211 + MFSD201 for the KFintech pilot.
  if (opts.reportCode !== undefined && !reportCovered(a, opts.reportCode)) throw new PostingGateError([reportOutOfScope(a?.reportCodes ?? null, opts.reportCode)]);
  return { registrars: a?.registrars ?? null, reportCodes: a?.reportCodes ?? null };
}

/** The refusal for a report type outside the activation. Free of "halted" (the worker parks a halted import; this one is BLOCKED). */
export const reportOutOfScope = (reportCodes: string[] | null, code: string | null | undefined) =>
  `blocked: this firm's activation covers report types ${reportCodes?.join(" + ") ?? "none"} only; a ${code ?? "unidentified"} file is refused — nothing is staged or posted`;

/** True for a gate refusal that means "outside the activation's scope" (registrar or report type), as opposed to a halt or a configuration error. */
export const isScopeRefusal = (e: unknown) => (e as any)?.name === "PostingGateError" && ((e as any).reasons ?? []).some((r: string) => /only; a .* (record|file) is refused/.test(r));

/** The refusal for a registrar outside the activation. Deliberately free of "halted" (the worker parks a halted import; this one fails). */
export const registrarOutOfScope = (registrars: string[] | null, rta: string | null | undefined) =>
  `this firm's activation covers ${registrars?.join(" + ") ?? "no registrar"} only; a ${rta ?? "unidentified"} record is refused — nothing is posted`;
