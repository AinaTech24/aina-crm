/**
 * Fetch a client's KYC status from the KRA (through the firm's NSE MF Invest
 * connection) and keep investors.kyc_status equal to it.
 *
 * Three rules:
 *  - The NSE call is made OUTSIDE any transaction; only the answer is written.
 *  - A failed call (service down, auth, network, an unknown remark) never
 *    changes the client's status. It is recorded in kyc_checks and nothing else.
 *  - Every answer is history: kyc_checks gets a row, and a change also writes
 *    the audit trail (`investor.kyc_from_kra`) and the event
 *    `investor.kyc_status_changed` for the automations.
 *
 * Nightly (runKycRefresh, workers/index.ts): every firm with a connection and
 * auto-refresh on, oldest check first — a client not yet verified is asked again
 * after 3 days, a verified one after 30 — up to NIGHTLY_CAP per firm, one call
 * at a time. A firm whose keys or IP are refused is stopped for the night after
 * the first refusal.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant, type Tx } from "@/db/client";
import { investors } from "@/db/schema/investors";
import { kycChecks } from "@/db/schema/kyc_checks";
import { eventsOutbox } from "@/db/schema/outbox";
import { recordAudit } from "@/lib/audit";
import { getNseCredentials, noteNseState } from "./credentials";
import { nseKycCheck, type NseCallResult, type NseCredentials } from "./nse-client";
import { kraLabel, kycVerdict, nseDate, PAN_RE } from "./nse-status";

export const NIGHTLY_CAP = 400;
const RECHECK_UNVERIFIED_DAYS = 3;
const RECHECK_VERIFIED_DAYS = 30;
const GAP_MS = 300;
/** Consecutive "service down" / network answers before a firm's run stops for the night. */
const MAX_OUTAGE_STREAK = 5;

export type KycCheckOutcome = {
  outcome: "ok" | "service_down" | "error";
  changed: boolean;
  statusBefore: string | null;
  statusAfter: string | null;
  remark: string | null;
  kra: string | null;
  error: string | null;
  /** auth: the keys or the IP were refused — not worth trying more PANs. */
  authFailed?: boolean;
};

type Subject = { id: string; pan: string; kycStatus: string | null; kycValidatedAt: string | null };

/** Record one NSE answer for one client. Pure DB work, inside the caller's tx. */
export async function recordKycAnswer(
  tx: Tx,
  args: { tenantId: string; subject: Subject; result: NseCallResult; trigger: "manual" | "nightly"; byUserId: string | null }
): Promise<KycCheckOutcome> {
  const { tenantId, subject, result, trigger, byUserId } = args;
  const before = subject.kycStatus;

  if (!result.ok) {
    await tx.insert(kycChecks).values({
      tenantId, investorId: subject.id, pan: subject.pan, source: "nse_mf", trigger,
      outcome: "error", statusBefore: before, statusAfter: before, changed: false,
      error: `${result.kind}${result.status ? ` ${result.status}` : ""}: ${result.message}`.slice(0, 500),
      checkedBy: byUserId,
    } as any);
    return { outcome: "error", changed: false, statusBefore: before, statusAfter: before, remark: null, kra: null, error: result.message, authFailed: result.kind === "auth" };
  }

  const a = result.answer;
  const verdict = kycVerdict(a.flag, a.remark);
  const kra = kraLabel(a.kraName);
  const outcome = verdict.kind === "service_down" ? "service_down" : "ok";
  const after = verdict.kind === "status" ? verdict.status : before;
  const changed = verdict.kind === "status" && after !== before;

  // The KRA answered for a different PAN — never write it onto this client.
  if (a.pan && a.pan !== subject.pan) {
    await tx.insert(kycChecks).values({
      tenantId, investorId: subject.id, pan: subject.pan, source: "nse_mf", trigger, outcome: "error",
      kraFlag: a.flag, kraRemark: a.remark, kraName: a.kraName, statusBefore: before, statusAfter: before,
      error: "NSE answered for a different PAN", checkedBy: byUserId,
    } as any);
    return { outcome: "error", changed: false, statusBefore: before, statusAfter: before, remark: a.remark, kra, error: "NSE answered for a different PAN" };
  }

  await tx.insert(kycChecks).values({
    tenantId, investorId: subject.id, pan: subject.pan, source: "nse_mf", trigger, outcome,
    kraFlag: a.flag, kraRemark: a.remark, kraName: a.kraName, kraStatusDate: a.statusDate,
    statusBefore: before, statusAfter: after, changed,
    error: verdict.kind === "unknown" ? `Unrecognised KRA remark: ${a.remark ?? a.flag ?? "(blank)"}` : null,
    checkedBy: byUserId,
  } as any);

  if (outcome === "service_down") {
    return { outcome, changed: false, statusBefore: before, statusAfter: before, remark: a.remark, kra, error: "The KRA's service is down — status unchanged" };
  }

  // What the KRA said, and when we asked — even when the status itself is unchanged.
  const validatedOn = after === "verified" ? nseDate(a.statusDate) : null;
  await tx
    .update(investors)
    .set({
      ...(changed ? { kycStatus: after as any, kycLastUpdatedBy: byUserId } : {}),
      ...(validatedOn && !subject.kycValidatedAt ? { kycValidatedAt: validatedOn } : {}),
      kycStatusRemark: a.remark,
      ...(kra ? { kraName: kra } : {}),
      kycCheckedAt: new Date(),
      kycCheckSource: "nse_mf",
    } as any)
    .where(sql`${investors.id} = ${subject.id}::uuid AND ${investors.tenantId} = ${tenantId}::uuid`);

  if (changed) {
    await recordAudit(tx, {
      tenantId,
      actorUserId: byUserId,
      actorType: byUserId ? "user" : "system",
      action: "investor.kyc_from_kra",
      entityType: "investor",
      entityId: subject.id,
      before: { kycStatus: before },
      after: { kycStatus: after, kraRemark: a.remark, kra },
      reason: `KYC status from ${kra ?? "the KRA"} via NSE MF Invest (${trigger})`,
    });
    await tx.insert(eventsOutbox).values({
      tenantId,
      kind: "investor.kyc_status_changed",
      entityType: "investor",
      entityId: subject.id,
      before: { kycStatus: before },
      after: { kycStatus: after, kraRemark: a.remark, kra, source: "nse_mf" },
      meta: { trigger, actorUserId: byUserId },
    } as any);
  }

  return {
    outcome: "ok", changed, statusBefore: before, statusAfter: after, remark: a.remark, kra,
    error: verdict.kind === "unknown" ? "The KRA's answer was not recognised — status unchanged" : null,
  };
}

async function loadSubject(tx: Tx, tenantId: string, investorId: string): Promise<Subject | null> {
  const [r] = await tx
    .select({ id: investors.id, pan: investors.pan, kycStatus: investors.kycStatus, kycValidatedAt: investors.kycValidatedAt })
    .from(investors)
    .where(sql`${investors.id} = ${investorId}::uuid AND ${investors.tenantId} = ${tenantId}::uuid AND ${investors.deletedAt} IS NULL`)
    .limit(1);
  const pan = String(r?.pan ?? "").trim().toUpperCase();
  if (!r || !PAN_RE.test(pan)) return null;
  return { id: r.id, pan, kycStatus: r.kycStatus ?? null, kycValidatedAt: r.kycValidatedAt ? String(r.kycValidatedAt) : null };
}

export type ManualCheck =
  | { ok: true; result: KycCheckOutcome }
  | { ok: false; error: "not_connected" | "no_pan" };

/**
 * One client, on demand (the client page's "Check KYC"). The caller has already
 * proved the viewer may edit this client.
 */
export async function checkInvestorKyc(tenantId: string, investorId: string, byUserId: string): Promise<ManualCheck> {
  const pre = await withTenant(tenantId, async (tx) => ({
    creds: await getNseCredentials(tx, tenantId),
    subject: await loadSubject(tx, tenantId, investorId),
  }));
  if (!pre.creds) return { ok: false, error: "not_connected" };
  if (!pre.subject) return { ok: false, error: "no_pan" };

  const call = await nseKycCheck(pre.creds, pre.subject.pan);
  const result = await withTenant(tenantId, async (tx) => {
    const r = await recordKycAnswer(tx, { tenantId, subject: pre.subject!, result: call, trigger: "manual", byUserId });
    if (r.authFailed) await noteNseState(tx, tenantId, { lastError: r.error, lastErrorAt: new Date().toISOString() });
    return r;
  });
  return { ok: true, result };
}

/** Settings → "Test connection": ask NSE about one PAN; nothing is written to a client. */
export async function testNseConnection(tenantId: string, creds: NseCredentials, pan: string) {
  const call = await nseKycCheck(creds, pan);
  const now = new Date().toISOString();
  await withTenant(tenantId, (tx) =>
    noteNseState(tx, tenantId, call.ok
      ? { lastTestAt: now, lastTestOk: true, lastError: null, lastErrorAt: null }
      : { lastTestAt: now, lastTestOk: false, lastError: call.message, lastErrorAt: now })
  );
  if (!call.ok) return { ok: false as const, kind: call.kind, message: call.message };
  return { ok: true as const, remark: call.answer.remark, kra: kraLabel(call.answer.kraName) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The clients due a check, oldest check first. */
async function dueSubjects(tx: Tx, tenantId: string, limit: number): Promise<Subject[]> {
  const r = await tx.execute(sql`
    SELECT id, upper(btrim(pan)) AS pan, kyc_status, kyc_validated_at::text AS kyc_validated_at
      FROM investors
     WHERE tenant_id = ${tenantId}::uuid
       AND deleted_at IS NULL AND merged_into_id IS NULL
       AND COALESCE(status, 'active') NOT IN ('closed', 'exited')
       AND upper(btrim(pan)) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
       AND (kyc_checked_at IS NULL
            OR kyc_checked_at < now() - CASE WHEN kyc_status = 'verified'
                                             THEN make_interval(days => ${RECHECK_VERIFIED_DAYS}::int)
                                             ELSE make_interval(days => ${RECHECK_UNVERIFIED_DAYS}::int) END)
     ORDER BY kyc_checked_at NULLS FIRST, created_at
     LIMIT ${limit}::int`);
  return (r.rows as any[]).map((x) => ({ id: String(x.id), pan: String(x.pan), kycStatus: x.kyc_status ?? null, kycValidatedAt: x.kyc_validated_at ?? null }));
}

export type KycRefreshResult = {
  tenants: number;
  checked: number;
  changed: number;
  failedTenants: string[];
  durationMs: number;
};

/** Nightly: every connected firm with auto-refresh on. Never throws for one firm. */
export async function runKycRefresh(): Promise<KycRefreshResult> {
  const t0 = Date.now();
  const tenantIds = await withSystem(async (tx: Tx) => {
    const r = await tx.execute(sql`
      SELECT ti.tenant_id FROM tenant_integrations ti JOIN tenants t ON t.id = ti.tenant_id
       WHERE ti.provider = 'nse_mf' AND ti.user_id IS NULL AND ti.is_active
         AND t.status IN ('active', 'trial')`);
    return (r.rows as any[]).map((x) => String(x.tenant_id));
  });

  let checked = 0;
  let changed = 0;
  const failedTenants: string[] = [];
  for (const tenantId of tenantIds) {
    try {
      const { creds, subjects } = await withTenant(tenantId, async (tx) => {
        const c = await getNseCredentials(tx, tenantId);
        return { creds: c, subjects: c?.autoRefresh ? await dueSubjects(tx, tenantId, NIGHTLY_CAP) : [] };
      }, { roles: ["system"] });
      if (!creds || !subjects.length) continue;

      let firmChecked = 0;
      let firmChanged = 0;
      let outage = 0;
      let stopReason: string | null = null;
      for (const s of subjects) {
        const call = await nseKycCheck(creds, s.pan);
        const r = await withTenant(tenantId, (tx) => recordKycAnswer(tx, { tenantId, subject: s, result: call, trigger: "nightly", byUserId: null }), { roles: ["system"] });
        firmChecked++;
        if (r.changed) firmChanged++;
        if (r.authFailed) { stopReason = r.error; break; }
        outage = r.outcome === "service_down" || (!call.ok && call.kind === "network") ? outage + 1 : 0;
        if (outage >= MAX_OUTAGE_STREAK) { stopReason = "NSE / the KRA did not answer — stopped for tonight"; break; }
        await sleep(GAP_MS);
      }
      checked += firmChecked;
      changed += firmChanged;
      const now = new Date().toISOString();
      await withTenant(tenantId, (tx) => noteNseState(tx, tenantId, {
        lastRunAt: now, lastRunChecked: firmChecked, lastRunChanged: firmChanged,
        ...(stopReason ? { lastError: stopReason, lastErrorAt: now } : {}),
      }), { roles: ["system"] });
      if (stopReason) failedTenants.push(tenantId);
    } catch (err) {
      console.error(`[kyc-refresh] tenant ${tenantId} failed:`, (err as Error)?.message);
      failedTenants.push(tenantId);
    }
  }
  return { tenants: tenantIds.length, checked, changed, failedTenants, durationMs: Date.now() - t0 };
}

// Re-exported for the API's "no PAN" message.
export { PAN_RE };
