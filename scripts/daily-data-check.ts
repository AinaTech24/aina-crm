/**
 * Daily data health: are the NAV / AUM jobs running, and are RTA files arriving
 * and importing, for every firm?
 *
 *   npx tsx scripts/daily-data-check.ts            # last 3 days
 *   npx tsx scripts/daily-data-check.ts --days 7
 *
 * Read-only (SELECTs only). Prints a plain report and exits 0, or exits 2 when
 * something needs a person: a job that has not run in its window, a stale NAV,
 * RTA imports that failed or are stuck, or a firm with no RTA file at all in
 * the window. Needs ALLOW_SYSTEM_TX=1 (set below) and the worker's DB URL; in
 * prod: docker exec -w /app app-worker-1 npx tsx scripts/daily-data-check.ts
 */
import "dotenv/config";
process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";

const argDays = process.argv.indexOf("--days");
const DAYS = argDays >= 0 ? Math.max(1, Number(process.argv[argDays + 1]) || 3) : 3;

const hoursAgo = (d: unknown) => (d ? (Date.now() - new Date(d as string).getTime()) / 3_600_000 : Infinity);
const fmtAge = (h: number) => (h === Infinity ? "never" : h < 48 ? `${h.toFixed(1)}h ago` : `${(h / 24).toFixed(1)}d ago`);
const cr = (v: unknown) => `Rs ${(Number(v ?? 0) / 1e7).toFixed(2)} Cr`;
const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : "-");

/** How long a job may go without a run before it is called late (hours). */
const JOB_WINDOW: Array<[RegExp, number]> = [
  [/^nav-refresh$/, 30],
  [/^nav-refresh-(2200|2330|0900|1200)$/, 30],
  [/aum/, 30],
  [/daily-firm-snapshot/, 30],
  [/mfapi/, 30],
  [/rta|imap|inbox/, 6],
];

async function main() {
  const problems: string[] = [];
  const out: string[] = [];
  const say = (s = "") => out.push(s);

  const sys = await withSystem(async (tx) => {
    const q = async (t: ReturnType<typeof sql>) => (await tx.execute(t)).rows as any[];
    return {
      jobs: await q(sql`SELECT job_name, last_run_at, last_run_status, last_run_detail, last_heartbeat_at FROM scheduler_state ORDER BY job_name`),
      nav: await q(sql`SELECT max(nav_date) FILTER (WHERE nav_date <= current_date + 1) AS d, count(*) FILTER (WHERE nav_date > current_date + 1) AS future, count(*) FILTER (WHERE nav_date = (SELECT max(nav_date) FROM scheme_nav WHERE nav_date <= current_date + 1)) AS at_max, count(*) AS n, max(updated_at) AS upd FROM scheme_nav`),
      inbound: await q(sql`SELECT outcome, count(*) AS n, max(received_at) AS last FROM rta_inbound_messages WHERE created_at > now() - make_interval(days => ${DAYS}::int) GROUP BY outcome ORDER BY outcome`),
      inboundBad: await q(sql`SELECT outcome, subject, from_address, reason, received_at FROM rta_inbound_messages WHERE created_at > now() - make_interval(days => ${DAYS}::int) AND outcome IN ('unroutable','error','no_attachment') ORDER BY created_at DESC LIMIT 8`),
      tenants: await q(sql`SELECT id, display_name AS name FROM tenants ORDER BY display_name`),
    };
  });

  say(`DATA HEALTH — window ${DAYS}d — ${new Date().toISOString()}`);
  say("");
  say("== Background jobs (scheduler_state) ==");
  for (const j of sys.jobs) {
    const name = String(j.job_name);
    const rule = JOB_WINDOW.find(([re]) => re.test(name));
    if (!rule) continue;
    const age = hoursAgo(j.last_run_at);
    const bad = age > rule[1] || (j.last_run_status && j.last_run_status !== "ok");
    if (age > rule[1]) problems.push(`job ${name} last ran ${fmtAge(age)}`);
    else if (j.last_run_status && j.last_run_status !== "ok") problems.push(`job ${name} status ${j.last_run_status}`);
    say(`${bad ? "!!" : "ok"} ${name.padEnd(24)} ${fmtAge(age).padEnd(10)} ${String(j.last_run_status ?? "").padEnd(8)} ${String(j.last_run_detail ?? "").slice(0, 110)}`);
  }

  say("");
  say("== NAV master (scheme_nav) ==");
  const nav = sys.nav[0];
  const navAge = hoursAgo(nav.d);
  if (Number(nav.future)) say(`note: ${nav.future} scheme(s) carry a NAV dated more than a day ahead — ignored here`);
  say(`latest NAV date ${day(nav.d)} (${fmtAge(navAge)}), ${nav.at_max} of ${nav.n} schemes carry it, table updated ${fmtAge(hoursAgo(nav.upd))}`);
  // NAV dates trail by a day, and a weekend by three.
  if (navAge > 24 * 4) problems.push(`NAV master is stale: latest date ${day(nav.d)}`);

  say("");
  say("== RTA mail intake (rta_inbound_messages) ==");
  if (!sys.inbound.length) say("(no inbound RTA mail in the window)");
  for (const r of sys.inbound) say(`${String(r.outcome).padEnd(14)} ${String(r.n).padStart(4)}   last ${fmtAge(hoursAgo(r.last))}`);
  for (const r of sys.inboundBad) {
    say(`  ${r.outcome}: "${String(r.subject ?? "").slice(0, 60)}" from ${r.from_address} — ${String(r.reason ?? "").slice(0, 80)}`);
  }
  const errMail = sys.inbound.filter((r: any) => r.outcome === "error" || r.outcome === "unroutable");
  for (const r of errMail) problems.push(`${r.n} inbound RTA mail(s) ${r.outcome}`);

  say("");
  say("== Per firm ==");
  for (const t of sys.tenants) {
    const d = await withTenant(t.id, async (tx) => {
      const q = async (s: ReturnType<typeof sql>) => (await tx.execute(s)).rows as any[];
      return {
        byStatus: await q(sql`SELECT status, count(*) AS n FROM rta_file_imports WHERE tenant_id = ${t.id}::uuid AND deleted_at IS NULL AND created_at > now() - make_interval(days => ${DAYS}::int) GROUP BY status ORDER BY status`),
        latest: await q(sql`SELECT kind, max(period_end) AS pe, max(created_at) AS up, count(*) AS n FROM rta_file_imports WHERE tenant_id = ${t.id}::uuid AND deleted_at IS NULL AND status IN ('completed','partial') GROUP BY kind ORDER BY max(created_at) DESC LIMIT 6`),
        bad: await q(sql`SELECT file_name, kind, status, created_at, left(coalesce(remarks, errors->0->>'reason', ''), 90) AS why FROM rta_file_imports WHERE tenant_id = ${t.id}::uuid AND deleted_at IS NULL AND created_at > now() - make_interval(days => ${DAYS}::int) AND (status IN ('failed','partial') OR (status = 'rejected' AND coalesce(remarks,'') NOT LIKE 'Not this firm%')) ORDER BY created_at DESC LIMIT 5`),
        foreign: await q(sql`SELECT count(*) AS n FROM rta_file_imports WHERE tenant_id = ${t.id}::uuid AND deleted_at IS NULL AND created_at > now() - make_interval(days => ${DAYS}::int) AND status = 'rejected' AND remarks LIKE 'Not this firm%'`),
        realRejected: await q(sql`SELECT count(*) AS n FROM rta_file_imports WHERE tenant_id = ${t.id}::uuid AND deleted_at IS NULL AND created_at > now() - make_interval(days => ${DAYS}::int) AND status = 'rejected' AND coalesce(remarks,'') NOT LIKE 'Not this firm%'`),
        stuck: await q(sql`SELECT file_name, status, created_at FROM rta_file_imports WHERE tenant_id = ${t.id}::uuid AND deleted_at IS NULL AND status IN ('uploaded','parsing') AND created_at < now() - interval '1 hour' ORDER BY created_at LIMIT 5`),
        snaps: await q(sql`SELECT snapshot_date, total_aum FROM firm_snapshots WHERE tenant_id = ${t.id}::uuid ORDER BY snapshot_date DESC LIMIT 4`),
        live: await q(sql`SELECT count(*) AS n, COALESCE(sum(aum),0) AS aum, max(updated_at) AS upd FROM investors WHERE tenant_id = ${t.id}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL AND COALESCE(status,'') NOT IN ('closed','exited')`),
        folioAum: await q(sql`SELECT COALESCE(sum(aum),0) AS aum, max(updated_at) AS upd FROM folios WHERE tenant_id = ${t.id}::uuid`),
      };
    });
    const total = d.byStatus.reduce((s: number, r: any) => s + Number(r.n), 0);
    const anyEver = d.latest.length > 0;
    if (!total && !anyEver && !Number(d.live[0].n)) continue; // an empty shell firm
    const foreign = Number(d.foreign[0].n);
    const realRejected = Number(d.realRejected[0].n);
    const failed = Number(d.byStatus.find((r: any) => r.status === "failed")?.n ?? 0);
    say(`${t.id.slice(0, 8)} ${String(t.name).trim()}`);
    say(`  AUM ${cr(d.live[0].aum)} over ${d.live[0].n} live clients (clients saved ${fmtAge(hoursAgo(d.live[0].upd))}; folios saved ${fmtAge(hoursAgo(d.folioAum[0].upd))}); snapshots: ${d.snaps.map((s: any) => `${day(s.snapshot_date)} ${cr(s.total_aum)}`).join(" · ") || "none"}`);
    if (d.snaps.length && hoursAgo(d.snaps[0].snapshot_date) > 24 * 3) problems.push(`${t.name}: newest firm snapshot is ${day(d.snaps[0].snapshot_date)}`);
    const own = d.byStatus.filter((r: any) => r.status !== "rejected").map((r: any) => `${r.n} ${r.status}`);
    say(`  RTA files in ${DAYS}d: ${own.length ? own.join(", ") : "NONE"}${foreign ? ` (+${foreign} other firms' files ignored — shared mailbox, normal)` : ""}${realRejected ? `, ${realRejected} REJECTED` : ""}   last good import: ${d.latest[0] ? `${d.latest[0].kind} ${fmtAge(hoursAgo(d.latest[0].up))}` : "never"}`);
    // No file of this firm's own in the window — and the last good import is old, or never.
    const ownCount = d.byStatus.filter((r: any) => r.status !== "rejected").reduce((n: number, r: any) => n + Number(r.n), 0);
    if (!ownCount && Number(d.live[0].n) > 50) problems.push(`${t.name}: no RTA file of its own in ${DAYS} days (last good import ${d.latest[0] ? fmtAge(hoursAgo(d.latest[0].up)) : "never"})`);
    if (realRejected) problems.push(`${t.name}: ${realRejected} RTA import(s) rejected for a reason other than another firm's file`);
    if (failed) problems.push(`${t.name}: ${failed} RTA import(s) failed`);
    for (const r of d.bad) say(`  ! ${r.status} ${day(r.created_at)} ${r.kind} ${r.file_name}${r.why ? ` — ${r.why}` : ""}`);
    for (const r of d.stuck) {
      say(`  ! stuck ${r.status} since ${fmtAge(hoursAgo(r.created_at))}: ${r.file_name}`);
      problems.push(`${t.name}: import stuck in ${r.status} (${r.file_name})`);
    }
  }

  say("");
  say(problems.length ? `NEEDS ATTENTION (${problems.length}):\n- ${problems.join("\n- ")}` : "ALL CLEAR");
  console.log(out.join("\n"));
  process.exit(problems.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
