/**
 * The posting gate (Phase 3F) — FAIL-CLOSED. Financial posting from staging
 * (lib/rta/posting/post.ts) runs only when EVERY one of these holds; anything
 * missing, malformed or ambiguous refuses:
 *
 *   1. RTA_POSTING_MODE is exactly "development".
 *   2. NODE_ENV is not "production", and no hosting platform says production
 *      (VERCEL_ENV, RAILWAY_ENVIRONMENT, APP_ENV, ENVIRONMENT).
 *   3. RTA_POSTING_DATABASE names the database posting may write to.
 *   4. The database URL in use points at this machine (localhost / 127.0.0.1 /
 *      ::1 / a unix socket).
 *   5. INSIDE the posting transaction, the connected server agrees:
 *      current_database() equals RTA_POSTING_DATABASE and the server address
 *      is loopback (or a unix socket).
 *
 * The environment checks (1–4) are evaluated on every call — nothing is
 * cached — and the database check (5) runs in the same transaction as the
 * writes, so a misconfigured process that passes 1–4 still cannot write to a
 * remote or differently-named database. There is no override flag.
 */
export class PostingGateError extends Error {
  constructor(public reasons: string[]) {
    super(`RTA posting is disabled — ${reasons.join("; ")}. Nothing was written.`);
    this.name = "PostingGateError";
  }
}

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

export function postingGateEnv(env: NodeJS.ProcessEnv = process.env): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if ((env.RTA_POSTING_MODE ?? "") !== "development") reasons.push(`RTA_POSTING_MODE is "${env.RTA_POSTING_MODE ?? ""}", not "development"`);
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") reasons.push("NODE_ENV is production");
  for (const k of ["VERCEL_ENV", "RAILWAY_ENVIRONMENT", "APP_ENV", "ENVIRONMENT"]) {
    if ((env[k] ?? "").toLowerCase() === "production") reasons.push(`${k} is production`);
  }
  if (!env.RTA_POSTING_DATABASE) reasons.push("RTA_POSTING_DATABASE is not set");
  const urls = [env.APP_DATABASE_URL, env.DATABASE_URL].filter((u): u is string => !!u);
  if (!urls.length) reasons.push("no database URL is configured");
  for (const u of urls) {
    const h = dbHost(u);
    if (!h) reasons.push("a database URL cannot be read");
    else if (h !== "unix-socket" && !LOOPBACK.has(h)) reasons.push("a database URL is not on this machine");
  }
  return { allowed: reasons.length === 0, reasons };
}

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

/** Throws PostingGateError unless the environment AND the connected database pass. Call inside the posting transaction. */
export async function assertPostingAllowed(tx: Tx, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const g = postingGateEnv(env);
  if (!g.allowed) throw new PostingGateError(g.reasons);
  const { sql } = await import("drizzle-orm");
  const r = (await tx.execute(sql`SELECT current_database() AS db, host(inet_server_addr()) AS addr`)).rows[0] as { db: string; addr: string | null };
  const reasons: string[] = [];
  if (r.db !== env.RTA_POSTING_DATABASE) reasons.push("the connected database is not RTA_POSTING_DATABASE");
  if (r.addr !== null && !["127.0.0.1", "::1"].includes(r.addr)) reasons.push("the connected database server is not on this machine");
  if (reasons.length) throw new PostingGateError(reasons);
}
