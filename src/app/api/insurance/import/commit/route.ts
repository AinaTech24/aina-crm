import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/insurance/import/commit — write parsed policy rows into the
 * insurance register (Zoho File Import parity). Each policy is linked to an
 * existing client by PAN; rows with no matching client error out. Policy type
 * + premium frequency are normalised to our enums; dedupe is by policy number.
 *
 * Body: { mapping: Record<sourceHeader, ourField>, rows: object[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({ mapping: z.record(z.string(), z.string()), rows: z.array(z.record(z.string(), z.any())) });

const POLICY_TYPES = ["term", "ulip", "endowment", "money_back", "health", "critical_illness", "personal_accident", "motor", "travel", "home", "life_other", "general_other"];
const FREQS = ["single", "annual", "semi_annual", "quarterly", "monthly"];

function normType(v: string): string {
  const s = v.toLowerCase().trim();
  if (POLICY_TYPES.includes(s)) return s;
  if (/term/.test(s)) return "term";
  if (/ulip|unit.?linked/.test(s)) return "ulip";
  if (/endow/.test(s)) return "endowment";
  if (/money.?back/.test(s)) return "money_back";
  if (/health|mediclaim/.test(s)) return "health";
  if (/critical/.test(s)) return "critical_illness";
  if (/accident|personal.?acc|pa\b/.test(s)) return "personal_accident";
  if (/motor|car|vehicle|two.?wheeler/.test(s)) return "motor";
  if (/travel/.test(s)) return "travel";
  if (/home|property|fire/.test(s)) return "home";
  if (/life/.test(s)) return "life_other";
  return s ? "general_other" : "life_other";
}
function normFreq(v: string): string {
  const s = v.toLowerCase().trim();
  if (FREQS.includes(s)) return s;
  if (/single|one.?time|lump/.test(s)) return "single";
  if (/annual|yearly|year|annum/.test(s)) return "annual";
  if (/semi|half/.test(s)) return "semi_annual";
  if (/quarter/.test(s)) return "quarterly";
  if (/month/.test(s)) return "monthly";
  return "annual";
}
const numOrNull = (v: string) => { const n = Number(String(v).replace(/[,₹\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const dateOrNull = (v: string) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };
const pick = (row: Record<string, any>, h: string | undefined) => (h && row[h] != null ? String(row[h]).trim() : "");

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);
    const { mapping, rows } = parse.data;

    const reverse: Record<string, string> = {};
    for (const [src, our] of Object.entries(mapping)) if (our) reverse[our] = src;
    if (!reverse.clientPan || !reverse.insurer || !reverse.planName) {
      return NextResponse.json({ error: "mapping must cover client PAN, insurer, and plan name" }, { status: 400 });
    }

    let inserted = 0, skipped = 0;
    const errors: Array<{ rowIndex: number; error: string }> = [];

    await withTenant(session.tenantId, async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const pan = pick(row, reverse.clientPan).toUpperCase();
        const insurer = pick(row, reverse.insurer);
        const planName = pick(row, reverse.planName);
        if (!pan || !insurer || !planName) { errors.push({ rowIndex: i, error: "missing PAN, insurer, or plan" }); continue; }

        const inv = (await tx.execute(sql`SELECT id FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND pan = ${pan} LIMIT 1`)).rows[0] as any;
        if (!inv) { errors.push({ rowIndex: i, error: `no client with PAN ${pan}` }); continue; }

        const policyNumber = pick(row, reverse.policyNumber) || null;
        if (policyNumber) {
          const dup = (await tx.execute(sql`SELECT 1 FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid AND policy_number = ${policyNumber} LIMIT 1`)).rows[0];
          if (dup) { skipped++; continue; }
        }

        try {
          await tx.execute(sql`
            INSERT INTO insurance_policies (
              id, tenant_id, branch_id, investor_id, policy_number, insurer, plan_name, policy_type,
              sum_assured, annual_premium, premium_frequency, policy_start_date, maturity_date, next_premium_due_date,
              nominee_name, nominee_relation, status, sold_by_user_id, sold_at, created_at, updated_at
            ) VALUES (
              ${uuid()}, ${session.tenantId}, ${session.branchId ?? null}, ${inv.id}::uuid, ${policyNumber}, ${insurer}, ${planName},
              ${normType(pick(row, reverse.policyType))},
              ${numOrNull(pick(row, reverse.sumAssured))}, ${numOrNull(pick(row, reverse.annualPremium))}, ${normFreq(pick(row, reverse.premiumFrequency))},
              ${dateOrNull(pick(row, reverse.policyStartDate))}, ${dateOrNull(pick(row, reverse.maturityDate))}, ${dateOrNull(pick(row, reverse.nextPremiumDueDate))},
              ${pick(row, reverse.nomineeName) || null}, ${pick(row, reverse.nomineeRelation) || null},
              'active', ${session.userId}::uuid, now(), now(), now()
            )`);
          inserted++;
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err?.message ?? "insert failed").slice(0, 160) });
        }
      }
      await recordAudit(tx, {
        tenantId: session.tenantId, actorUserId: session.userId, action: "insurance.bulk_import",
        entityType: "insurance_policy", entityId: null,
        meta: { inserted, skipped, errored: errors.length, totalRows: rows.length }, ...meta,
      });
    });

    return NextResponse.json({ inserted, skipped, errored: errors.length, errors: errors.slice(0, 50) });
  } catch (err: any) {
    return handleApiError(err);
  }
}
