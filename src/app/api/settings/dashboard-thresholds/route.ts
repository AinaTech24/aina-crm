/**
 * GET    /api/settings/dashboard-thresholds   the firm's thresholds: defaults, saved overrides, effective values
 * PUT    /api/settings/dashboard-thresholds   { settings: { key: value, … } } — save overrides
 * DELETE /api/settings/dashboard-thresholds   back to the code defaults
 *
 * The branch command centre's brief forbids hard-coded judgement thresholds —
 * the target matrix's amber band, when a lead is stale, when a proposal needs
 * attention. They live in dashboard_settings (migration 0219) as overrides on
 * top of DEFAULT_DASHBOARD_THRESHOLDS.
 *
 * Saving goes through sanitizeThresholdOverrides — the SAME function the
 * dashboards read through — so what can be stored and what is honoured are one
 * rule: an unknown key or an out-of-bounds value is dropped, never saved.
 *
 * The same row also holds other firm settings — the escalation ladder
 * (`escalationLadder`, lib/tasks/escalation-ladder.ts) and QA sampling
 * (`qaSampling`, lib/qa/sampling.ts). Saving or resetting the thresholds
 * keeps every key in KEPT_KEYS.
 *
 * Gated on `settings.dashboard` (owner by default; grantable per user).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import {
  CONFIGURABLE_THRESHOLDS, DEFAULT_DASHBOARD_THRESHOLDS, loadDashboardThresholds, sanitizeThresholdOverrides,
} from "@/lib/dashboard/thresholds";

export const dynamic = "force-dynamic";

/** Firm settings stored in the same row that are not thresholds. */
const KEPT_KEYS = ["escalationLadder", "qaSampling"];
const kept = (col: string) => sql`(SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  FROM jsonb_each(COALESCE(${sql.raw(col)}, '{}'::jsonb)) e WHERE e.key = ANY(${`{${KEPT_KEYS.join(",")}}`}::text[]))`;

const Body = z.object({ settings: z.record(z.string(), z.unknown()) });

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.dashboard", session.permissions);
    const out = await withTenant(session.tenantId, async (tx) => {
      const row = (await tx.execute(sql`
        SELECT settings, updated_at FROM dashboard_settings WHERE tenant_id = ${session.tenantId}::uuid
      `)).rows[0] as
        | { settings: unknown; updated_at: string }
        | undefined;
      return {
        overrides: sanitizeThresholdOverrides(row?.settings),
        effective: await loadDashboardThresholds(tx),
        updatedAt: row?.updated_at ?? null,
      };
    });
    return NextResponse.json({ defaults: DEFAULT_DASHBOARD_THRESHOLDS, fields: CONFIGURABLE_THRESHOLDS, ...out });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.dashboard", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const clean = sanitizeThresholdOverrides(parse.data.settings);
    // Say which values were refused, so the form can show it rather than
    // pretending the save took everything.
    const rejected = Object.keys(parse.data.settings).filter(
      (k) => parse.data.settings[k] != null && parse.data.settings[k] !== "" && !(k in clean),
    );
    const effective = await withTenant(session.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO dashboard_settings (tenant_id, settings, updated_by, updated_at)
        VALUES (${session.tenantId}::uuid, ${JSON.stringify(clean)}::jsonb, ${session.userId}::uuid, now())
        ON CONFLICT (tenant_id) DO UPDATE
          SET settings = EXCLUDED.settings || ${kept("dashboard_settings.settings")},
              updated_by = EXCLUDED.updated_by, updated_at = now()
      `);
      return loadDashboardThresholds(tx);
    });
    return NextResponse.json({ ok: true, overrides: clean, effective, rejected });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.dashboard", session.permissions);
    await withTenant(session.tenantId, async (tx) => {
      // Back to the defaults, keeping the other firm settings (KEPT_KEYS).
      // Explicit predicate as well as RLS — never a bare DELETE.
      await tx.execute(sql`
        UPDATE dashboard_settings
           SET settings = ${kept("settings")},
               updated_by = ${session.userId}::uuid, updated_at = now()
         WHERE tenant_id = ${session.tenantId}::uuid
      `);
    });
    return NextResponse.json({ ok: true, effective: DEFAULT_DASHBOARD_THRESHOLDS });
  } catch (err) {
    return handleApiError(err);
  }
}
