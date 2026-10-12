/**
 * Rebuild the canonical SIP Master from everything staged for a firm, persist
 * it (rta_sip_registrations), and post VERIFIED registrations into the CRM's
 * SIP book (`sips`) — DEVELOPMENT ONLY, behind the posting gate.
 *
 * Sources: registration rows (MFSD243 / WBR49 primary, MFSD230 supplementary)
 * and instalment rows (MFSD201 / R2) from every staged batch of the firm.
 * Owner: the folio ON RECORD (registrar + AMC + folio). A registration whose
 * folio is not on record has no owner and is never posted.
 *
 * What reaches `sips`: kind SIP, owner on record, frequency and amount known,
 * and a VERIFIED state — VERIFIED_ACTIVE → active, PENDING → pending, PAUSED →
 * paused, STOPPED → stopped, EXPIRED → expired, REJECTED → rejected.
 * OBSERVED_ACTIVITY and UNKNOWN never reach `sips` (nothing is guessed). A
 * CRM SIP that matches (same folio, scheme, amount, frequency) is linked, not
 * duplicated; one whose status differs is reported as a conflict and left
 * unchanged. Only a SIP this process created itself is updated when the
 * registrar's status moves on.
 */
import { isResolved, loadSchemeResolutions, observeSchemeCodes, schemeGateOn } from "../scheme-resolution";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { buildSipMaster, type InstalmentEvent, type RegistrationObservation, type RegistrationSource, type SipMasterEntry } from "../sip-master";
import { refreshActiveSipAmount } from "@/lib/metrics/sip";
import { assertPostingAllowed } from "./gate";
import { registrarCovered, reportCovered } from "./controls";

type Tx = any;

const STATE_TO_SIP: Record<string, "active" | "pending" | "paused" | "stopped" | "expired" | "rejected" | undefined> = {
  ACTIVE: "active", PENDING: "pending", PAUSED: "paused", STOPPED: "stopped", EXPIRED: "expired", REJECTED: "rejected",
};
const REPORT_SOURCE: Record<string, RegistrationSource> = { WBR49: "cams.wbr49", MFSD243: "kfintech.mfsd243", MFSD230: "kfintech.mfsd230" };

export type SipBookOutcome = {
  registrations: number;
  byState: Record<string, number>;
  sips: { created: number; updated: number; linked: number; conflicts: number; notPosted: number; schemeUnresolved?: number };
  coverage: { cams: { missingFromMaster: number }; kfintech: { missingFromMaster: number } };
};

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const n = (v: unknown) => (s(v) && /^-?\d+$/.test(s(v)!) ? Number(s(v)) : null);

export async function rebuildSipBook(tenantId: string, opts: { asOf?: string; userId?: string | null } = {}): Promise<SipBookOutcome> {
  const asOf = opts.asOf ?? new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  return withTenant(tenantId, async (tx: Tx) => {
    const scope = await assertPostingAllowed(tx, tenantId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"rta_sip_book:" + tenantId}, 0))`);

    // Registration observations. A registration report's own date is the
    // latest registration date it carries — the most its status can speak for.
    const regRows = (await tx.execute(sql`
      SELECT b.id AS batch_id, b.report_code, b.rta, r.amc_code, r.folio_number, r.scheme_code, r.registrar_txn_no, r.amount::text AS amount,
             r.trade_date::text AS start_date, r.attrs,
             max(r.attrs->>'registrationDate') OVER (PARTITION BY b.id) AS report_date
        FROM rta_staging_rows r JOIN rta_staging_batches b ON b.tenant_id = r.tenant_id AND b.id = r.batch_id
       WHERE r.tenant_id = ${tenantId}::uuid AND b.record_kind = 'registration' AND r.state <> 'invalid'
         AND b.state IN ('ready_to_commit', 'exception')
    `)).rows as Array<{ batch_id: string; report_code: string; rta: "cams" | "kfintech"; amc_code: string; folio_number: string; scheme_code: string; registrar_txn_no: string | null; amount: string | null; start_date: string | null; attrs: Record<string, unknown>; report_date: string | null }>;
    // A registration report outside the activation's report types (0243) never feeds the book.
    const observations: RegistrationObservation[] = regRows.filter((r) => reportCovered(scope, r.report_code) && REPORT_SOURCE[r.report_code] && r.folio_number && r.scheme_code).map((r) => {
      const a = r.attrs ?? {};
      const total = n(a.installments), paid = n(a.paidInstallments);
      return {
        source: REPORT_SOURCE[r.report_code], reportDate: (r.report_date ?? r.start_date ?? asOf).slice(0, 10), rta: r.rta,
        amcCode: r.amc_code ?? "", registrationId: r.registrar_txn_no, folio: r.folio_number, scheme: r.scheme_code, targetScheme: s(a.target),
        kindCode: s(a.kind) ?? "", amount: r.amount == null ? null : Number(r.amount), frequencyText: s(a.frequency) ?? "",
        startDate: r.start_date, endDate: s(a.endDate), registeredOn: s(a.registrationDate), statusText: s(a.registrarStatus),
        ceaseDate: s(a.ceaseDate), terminateDate: s(a.terminateDate), pauseFrom: s(a.pauseFrom), pauseTo: s(a.pauseTo),
        totalInstalments: total, paidInstalments: paid, pendingInstalments: total != null && paid != null ? total - paid : null,
      };
    });

    // Instalments: processed systematic rows and refused instalments, from every staged transaction batch.
    const evRows = (await tx.execute(sql`
      SELECT b.rta, b.report_code, r.amc_code, r.folio_number, r.scheme_code, r.trade_date::text AS d, r.amount::text AS amount, r.rta_class, r.exception_code,
             r.attrs->>'sipRegistrationId' AS kfin_ref, r.attrs->>'sipRef' AS cams_ref, r.attrs->>'rejectionReason' AS reason
        FROM rta_staging_rows r JOIN rta_staging_batches b ON b.tenant_id = r.tenant_id AND b.id = r.batch_id
       WHERE r.tenant_id = ${tenantId}::uuid AND b.record_kind = 'transaction' AND r.trade_date IS NOT NULL
         AND ((r.rta_class IN ('sip_investment', 'stp_in', 'stp_out', 'swp_withdrawal') AND r.exception_code IS NULL AND r.state IN ('staged', 'staged_as_part', 'duplicate'))
              OR r.exception_code = 'instalment_rejected')
    `)).rows as Array<{ rta: "cams" | "kfintech"; amc_code: string; folio_number: string; scheme_code: string; d: string; amount: string | null; rta_class: string; exception_code: string | null; kfin_ref: string | null; cams_ref: string | null; reason: string | null }>;
    const events: InstalmentEvent[] = evRows.filter((r: any) => reportCovered(scope, r.report_code)).map((r) => ({
      rta: r.rta, amcCode: r.amc_code ?? "", registrationRef: r.rta === "kfintech" ? r.kfin_ref : r.cams_ref, folio: r.folio_number, scheme: r.scheme_code,
      date: r.d, outcome: r.exception_code === "instalment_rejected" ? "rejected" : "processed", amount: r.amount == null ? null : Math.abs(Number(r.amount)),
      reason: r.reason ?? undefined,
      kind: r.rta_class === "sip_investment" ? "sip" : r.rta_class === "stp_in" || r.rta_class === "stp_out" ? "stp" : r.rta_class === "swp_withdrawal" ? "swp" : undefined,
    }));

    const folios = (await tx.execute(sql`
      SELECT f.id, f.rta::text AS rta, f.amc_code, f.folio_number, f.investor_id, f.amc_name, i.rm_id
        FROM folios f JOIN investors i ON i.id = f.investor_id
       WHERE f.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
    `)).rows as Array<{ id: string; rta: string; amc_code: string; folio_number: string; investor_id: string; amc_name: string | null; rm_id: string | null }>;
    const folioMap = new Map(folios.map((f) => [`${f.rta}|${f.amc_code}|${f.folio_number}`, f]));
    const master = buildSipMaster(observations, events, asOf, {
      ownerOf: (r) => { const f = folioMap.get(`${r.rta}|${r.amcCode}|${r.folio}`); return f ? { investorId: String(f.investor_id), folioId: String(f.id), rule: "existing_folio_owner" } : null; },
    });

    const persisted = (e: SipMasterEntry) => (e.state === "ACTIVE" ? "VERIFIED_ACTIVE" : e.state);
    // The ARN each registration is reported under (MFSD243 / MFSD230 state it; WBR49 does not).
    const arnOf = new Map<string, string>();
    for (const r of regRows) {
      const arn = s(r.attrs?.arn);
      if (arn && r.registrar_txn_no) arnOf.set(`${r.rta}|${r.amc_code ?? ""}|${r.registrar_txn_no}`, arn.toUpperCase().replace(/^ARN[-\s]*/, "ARN-"));
    }
    // Scheme identity (Phase 3H): every registration's registrar code against the
    // Scheme Master crosswalk. With the scheme gate on, an unresolved scheme is
    // not posted to the SIP book (it stays visible in the SIP Master).
    for (const bId of [...new Set(regRows.map((r) => r.batch_id))]) await observeSchemeCodes(tx, tenantId, bId);
    const schemeMap = await loadSchemeResolutions(tx, tenantId, master.entries.map((e) => ({ rta: e.rta, amcCode: e.amcCode ?? "", schemeCode: e.scheme })));
    const gate = schemeGateOn();
    const sips = { created: 0, updated: 0, linked: 0, conflicts: 0, notPosted: 0, schemeUnresolved: 0 };
    const touchedInvestors = new Set<string>();
    for (const e of master.entries) {
      const prev = (await tx.execute(sql`SELECT id, sip_id FROM rta_sip_registrations WHERE tenant_id = ${tenantId}::uuid AND registration_key = ${e.key}`)).rows[0] as { id: string; sip_id: string | null } | undefined;
      let sipId: string | null = prev?.sip_id ?? null;
      const target = STATE_TO_SIP[e.state];
      const sch = schemeMap.get(`${e.rta}|${e.amcCode ?? ""}|${e.scheme}`);
      const schemeOk = !gate || isResolved(sch?.status);
      // A registrar outside the firm's activation (0242) never reaches the SIP book; it stays visible in the SIP Master.
      const inScope = registrarCovered(scope, e.rta);
      if (!inScope) e.stateBasis = `${e.stateBasis}; not posted to the SIP book: ${e.rta} is outside this firm's activation`;
      const postable = e.kind === "sip" && !!e.owner && !!e.frequency && e.amount != null && !!target && e.confidence === "verified" && schemeOk && inScope;
      if (!schemeOk && e.kind === "sip" && e.confidence === "verified") {
        sips.schemeUnresolved++;
        e.stateBasis = `${e.stateBasis}; not posted to the SIP book: scheme ${e.amcCode}/${e.scheme} is ${sch?.status ?? "unresolved"} in the Scheme Master`;
      }
      if (!postable) sips.notPosted++;
      else {
        const f = folioMap.get(`${e.rta}|${e.amcCode}|${e.folio}`)!;
        const ours = sipId ? ((await tx.execute(sql`SELECT id, status FROM sips WHERE tenant_id = ${tenantId}::uuid AND id = ${sipId}::uuid`)).rows[0] as { id: string; status: string } | undefined) : undefined;
        if (ours) {
          if (ours.status !== target) {
            await tx.execute(sql`UPDATE sips SET status = ${target}, remarks = ${`Registrar status (${e.status?.source ?? "registration report"}, ${e.statusEffectiveDate ?? asOf})`}, updated_at = now() WHERE id = ${ours.id}::uuid`);
            sips.updated++;
          }
        } else {
          const crm = (await tx.execute(sql`
            SELECT id, status FROM sips WHERE tenant_id = ${tenantId}::uuid AND folio_id = ${f.id}::uuid
               AND (scheme_code = ${e.scheme} OR scheme_code = ${sch?.amfiSchemeCode ?? e.scheme})
               AND amount = ${e.amount} AND frequency = ${e.frequency}`)).rows as Array<{ id: string; status: string }>;
          if (crm.length === 1 && crm[0].status === target) { sipId = crm[0].id; sips.linked++; }
          else if (crm.length) { sips.conflicts++; sipId = null; e.stateBasis = `${e.stateBasis}; the CRM holds ${crm.length} SIP(s) on this folio and scheme with a different status — not changed, held for review`; }
          else {
            const ins = (await tx.execute(sql`
              INSERT INTO sips (tenant_id, investor_id, folio_id, folio_number, amc_code, amc_name, scheme_code, rta_scheme_code, scheme_name, amount, frequency, start_date, end_date, status, rm_id, remarks)
              VALUES (${tenantId}::uuid, ${f.investor_id}::uuid, ${f.id}::uuid, ${e.folio}, ${e.amcCode}, ${sch?.amcName ?? f.amc_name ?? e.amcCode}, ${sch?.amfiSchemeCode ?? e.scheme}, ${e.scheme}, ${sch?.schemeName ?? e.scheme},
                ${e.amount}, ${e.frequency}, ${e.startDate}::date, ${e.endDate}::date, ${target}, ${f.rm_id}::uuid,
                ${`From the registrar's registration ${e.registrationId} (${e.sources.join(", ")}), status as of ${e.statusEffectiveDate ?? asOf}`})
              RETURNING id`)).rows[0] as { id: string };
            sipId = ins.id; sips.created++;
          }
        }
        touchedInvestors.add(String(f.investor_id));
      }
      const v = {
        rta: e.rta, amc: e.amcCode, reg: e.registrationId, inv: e.owner?.investorId ?? null, fol: e.owner?.folioId ?? null,
        arn: e.registrationId ? arnOf.get(`${e.rta}|${e.amcCode ?? ""}|${e.registrationId}`) ?? null : null,
      };
      await tx.execute(sql`
        INSERT INTO rta_sip_registrations (tenant_id, registration_key, rta, amc_code, registration_id, investor_id, folio_id, folio_number, scheme_code,
          target_scheme_code, kind, amount, frequency, start_date, end_date, state, state_basis, status_effective_date, last_successful_instalment,
          described, confidence, lifecycle_events, sources, sip_id, as_of, arn, amfi_scheme_code, scheme_status)
        VALUES (${tenantId}::uuid, ${e.key}, ${v.rta}, ${v.amc}, ${v.reg}, ${v.inv}::uuid, ${v.fol}::uuid, ${e.folio}, ${e.scheme},
          ${e.targetScheme}, ${e.kind}, ${e.amount}, ${e.frequency}, ${e.startDate}::date, ${e.endDate}::date, ${persisted(e)}, ${e.stateBasis},
          ${e.statusEffectiveDate}::date, ${e.lastSuccessfulInstalment}::date, ${e.described}, ${e.confidence},
          ${JSON.stringify(e.lifecycleEvents)}::jsonb, ${JSON.stringify(e.sources)}::jsonb, ${sipId}::uuid, ${asOf}::date, ${v.arn},
          ${sch?.amfiSchemeCode ?? null}, ${sch?.status ?? "unresolved"})
        ON CONFLICT (tenant_id, registration_key) DO UPDATE SET
          investor_id = EXCLUDED.investor_id, folio_id = EXCLUDED.folio_id, kind = EXCLUDED.kind, amount = EXCLUDED.amount,
          frequency = EXCLUDED.frequency, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, state = EXCLUDED.state,
          state_basis = EXCLUDED.state_basis, status_effective_date = EXCLUDED.status_effective_date,
          last_successful_instalment = EXCLUDED.last_successful_instalment, described = EXCLUDED.described, confidence = EXCLUDED.confidence,
          lifecycle_events = EXCLUDED.lifecycle_events, sources = EXCLUDED.sources, sip_id = COALESCE(EXCLUDED.sip_id, rta_sip_registrations.sip_id),
          as_of = EXCLUDED.as_of, arn = COALESCE(EXCLUDED.arn, rta_sip_registrations.arn),
          amfi_scheme_code = EXCLUDED.amfi_scheme_code, scheme_status = EXCLUDED.scheme_status, updated_at = now()`);
    }
    if (touchedInvestors.size) await refreshActiveSipAmount(tx, { tenantId, investorIds: [...touchedInvestors] });
    const byState: Record<string, number> = {};
    for (const e of master.entries) { const k = `${e.kind}:${persisted(e)}`; byState[k] = (byState[k] ?? 0) + 1; }
    return { registrations: master.entries.length, byState, sips, coverage: { cams: { missingFromMaster: master.coverage.cams.missingFromMaster }, kfintech: { missingFromMaster: master.coverage.kfintech.missingFromMaster } } };
  });
}
