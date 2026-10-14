/**
 * The Practice Systems Map — how far the firm runs as a system
 * (The E-Myth Revisited).
 *
 * For every core process in PRACTICE_PROCESSES, four pillars:
 *
 *   documented  an SOP (live, not deleted) is linked to the process itself
 *               (sop_links process = key), or to work that belongs to it: one
 *               of its task types, service-request types, or a stage of its
 *               journey blueprint ("<subject>:<stage>").
 *   owned       practice_process_settings names an owner POSITION, and that
 *               position has at least one active holder. A position nobody
 *               fills owns nothing.
 *   measured    its measure (./measures.ts) can be computed from the CRM's
 *               data — "no data" is not measured.
 *   automated   a workflow installed from one of its recipes is enabled, or
 *               an enabled automation rule (workflow_rules, the Automations
 *               page) acts on one of the process's modules.
 *
 * Score = pillars met ÷ (4 × processes), as a whole percentage.
 *
 * `scoreProcesses` and `nextStep` are pure (tests/practice-map.test.ts);
 * `loadSystemsMap` takes a tenant tx. SERVER-ONLY for the loader.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { ALL_RECIPES } from "@/lib/recipes";
import { PRACTICE_PROCESSES, SYSTEM_PILLARS, type PracticeProcess, type ProcessMeasureKey, type SystemPillar } from "./catalog";
import { runAllMeasures, type MeasureResult } from "./measures";

export type PillarState = Record<SystemPillar, boolean>;

export type MapSop = {
  sopId: string;
  title: string;
  /** The sop_links row; only a link straight to the process can be unlinked here. */
  linkId: string;
  via: "process" | "task_type" | "sr_type" | "blueprint_stage";
  targetKey: string;
};

export type MapOwner = {
  positionId: string;
  title: string;
  holders: Array<{ userId: string; name: string }>;
};

export type MapRecipe = {
  key: string;
  name: string;
  /** The installed workflow (the enabled one, else the latest), or null when not installed. */
  workflowId: string | null;
  enabled: boolean;
  /**
   * Its current version is published. A recipe installed from the library
   * lands as a disabled DRAFT with no trigger rows: turning it on means
   * publishing it (POST /api/workflows/[id]/publish, which enables it and
   * materialises its triggers), not just flipping `enabled`.
   */
  published: boolean;
};

export type SystemsMapRow = {
  key: string;
  name: string;
  outcome: string;
  defaultOwner: string;
  measureKey: ProcessMeasureKey;
  pillars: PillarState;
  sops: MapSop[];
  owner: MapOwner | null;
  notes: string | null;
  measure: MeasureResult;
  recipes: MapRecipe[];
  /** Enabled automation rules on the process's modules (Automations page). */
  rules?: Array<{ id: string; name: string }>;
};

export type MapScore = { met: number; total: number; pct: number };

export type SystemsMap = {
  rows: SystemsMapRow[];
  score: MapScore;
  positions: Array<{ id: string; title: string; holders: number }>;
  /** The firm's live SOPs, for the link picker. */
  sops: Array<{ id: string; title: string }>;
};

/* ───────────────────────────── pure ───────────────────────────── */

/** Pillars met over every process, as a whole percentage (0 with no processes). */
export function scoreProcesses(rows: Array<{ pillars: PillarState }>): MapScore {
  const total = rows.length * SYSTEM_PILLARS.length;
  const met = rows.reduce((s, r) => s + SYSTEM_PILLARS.filter((p) => r.pillars[p.key]).length, 0);
  return { met, total, pct: total ? Math.round((met / total) * 100) : 0 };
}

/** Pillars met by one process (0–4). */
export function pillarsMet(row: { pillars: PillarState }): number {
  return SYSTEM_PILLARS.filter((p) => row.pillars[p.key]).length;
}

export type NextStep = { pillar: SystemPillar; text: string; href: string };

/** Where to start recording the data a measure needs. */
export const MEASURE_SOURCE: Record<ProcessMeasureKey, { text: string; href: string }> = {
  lead_conversion: { text: "Record enquiries as leads so conversion can be counted", href: "/dashboard/leads" },
  lead_to_client_days: { text: "Convert won leads to clients and import the RTA feed so first investments show", href: "/dashboard/rta-imports" },
  onboarding_days: { text: "Convert won leads to clients and import the RTA feed so first investments show", href: "/dashboard/rta-imports" },
  sip_rejection_recovery: { text: "Import the RTA feed so SIP rejections are recorded", href: "/dashboard/rta-imports" },
  redemption_followed_up: { text: "Import the RTA feed so redemptions are recorded", href: "/dashboard/rta-imports" },
  review_on_time: { text: "Set a next review date or a service tier on your clients", href: "/dashboard/investors" },
  sr_within_sla: { text: "Log client requests as service requests", href: "/dashboard/service-requests" },
  complaint_within_sla: { text: "Log complaints in the complaint register", href: "/dashboard/complaints" },
  renewal_on_time: { text: "Record insurance policies with their premium due dates", href: "/dashboard/insurance" },
  kyc_expiry_cleared: { text: "Record your clients' KYC status", href: "/dashboard/reports/kyc-tracker" },
  rta_import_freshness: { text: "Import your first CAMS / KFintech file", href: "/dashboard/rta-imports" },
  birthday_wished: { text: "Record clients' dates of birth and send or log the birthday wish in the CRM", href: "/dashboard/investors" },
};

/**
 * The first pillar a process is missing, as one instruction and where to do
 * it. Null when the process is fully systemised.
 */
export function nextStep(row: Pick<SystemsMapRow, "key" | "pillars" | "owner" | "recipes" | "measureKey">): NextStep | null {
  if (!row.pillars.documented) {
    return { pillar: "documented", text: "Write down how it is done: link an SOP to it", href: "/dashboard/sops/new" };
  }
  if (!row.pillars.owned) {
    if (row.owner && row.owner.holders.length === 0) {
      return { pillar: "owned", text: `Give the ${row.owner.title} position a holder`, href: "/dashboard/practice/positions" };
    }
    return { pillar: "owned", text: "Choose the position that answers for it", href: "/dashboard/practice/positions" };
  }
  if (!row.pillars.measured) {
    const src = MEASURE_SOURCE[row.measureKey];
    return { pillar: "measured", text: src.text, href: src.href };
  }
  if (!row.pillars.automated) {
    // The process's own row on the map, opened at its automations.
    const href = `/dashboard/practice#${processAnchor(row.key)}`;
    const installed = row.recipes.find((r) => r.workflowId && !r.enabled);
    if (installed) return { pillar: "automated", text: `Turn on the "${installed.name}" automation`, href };
    const first = row.recipes[0];
    return {
      pillar: "automated",
      text: first ? `Install the "${first.name}" automation` : "Set up an automation for it",
      href: first ? href : "/dashboard/automations",
    };
  }
  return null;
}

/** The id of a process's SOPs-and-automations panel on the map. */
export function processAnchor(key: string): string {
  return `process-${key}-more`;
}

/** Which links document a process (pure, for the loader and the tests). */
export function linkDocumentsProcess(
  p: Pick<PracticeProcess, "key" | "taskTypes" | "srTypes" | "blueprintSubject">,
  link: { targetKind: string; targetKey: string },
): boolean {
  switch (link.targetKind) {
    case "process": return link.targetKey === p.key;
    case "task_type": return !!p.taskTypes?.includes(link.targetKey);
    case "sr_type": return !!p.srTypes?.includes(link.targetKey);
    case "blueprint_stage": return !!p.blueprintSubject && link.targetKey.startsWith(`${p.blueprintSubject}:`);
    default: return false;
  }
}

/* ───────────────────────────── loader ───────────────────────────── */

const RECIPE_NAME = new Map(ALL_RECIPES.map((r) => [r.key, r.name]));

export function recipeName(key: string): string {
  return RECIPE_NAME.get(key) ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export async function loadSystemsMap(tx: Tx, tenantId: string): Promise<SystemsMap> {
  const links = (await tx.execute(sql`
    SELECT l.id, l.sop_id, l.target_kind, l.target_key, s.title
      FROM sop_links l JOIN sops s ON s.id = l.sop_id AND s.tenant_id = ${tenantId}::uuid AND s.deleted_at IS NULL
     WHERE l.tenant_id = ${tenantId}::uuid
       AND l.target_kind IN ('process', 'task_type', 'sr_type', 'blueprint_stage')
     ORDER BY s.title
  `)).rows as Array<{ id: string; sop_id: string; target_kind: MapSop["via"]; target_key: string; title: string }>;

  const settings = (await tx.execute(sql`
    SELECT process_key, owner_position_id, notes FROM practice_process_settings WHERE tenant_id = ${tenantId}::uuid
  `)).rows as Array<{ process_key: string; owner_position_id: string | null; notes: string | null }>;

  const positions = (await tx.execute(sql`
    SELECT id, title FROM practice_positions WHERE tenant_id = ${tenantId}::uuid ORDER BY sort, title
  `)).rows as Array<{ id: string; title: string }>;

  const holders = (await tx.execute(sql`
    SELECT h.position_id, u.id AS user_id, u.name
      FROM practice_position_holders h
      JOIN users u ON u.id = h.user_id AND u.tenant_id = ${tenantId}::uuid AND u.status = 'active' AND u.deleted_at IS NULL
     WHERE h.tenant_id = ${tenantId}::uuid
     ORDER BY u.name
  `)).rows as Array<{ position_id: string; user_id: string; name: string }>;

  const allRecipeKeys = [...new Set(PRACTICE_PROCESSES.flatMap((p) => p.recipeKeys))];
  const wfs = allRecipeKeys.length ? (await tx.execute(sql`
    SELECT w.id, w.recipe_key, w.enabled, (v.status = 'published') AS published
      FROM workflows w
      LEFT JOIN workflow_versions v ON v.id = w.current_version_id AND v.tenant_id = ${tenantId}::uuid
     WHERE w.tenant_id = ${tenantId}::uuid
       AND w.recipe_key IN (${sql.join(allRecipeKeys.map((k) => sql`${k}`), sql`, `)})
       AND w.paused_reason IS DISTINCT FROM 'deleted'
     ORDER BY w.enabled DESC, w.updated_at DESC
  `)).rows as Array<{ id: string; recipe_key: string; enabled: boolean; published: boolean | null }> : [];

  const allRuleModules = [...new Set(PRACTICE_PROCESSES.flatMap((p) => p.ruleModules ?? []))];
  const ruleRows = allRuleModules.length ? (await tx.execute(sql`
    SELECT id, name, module FROM workflow_rules
     WHERE tenant_id = ${tenantId}::uuid AND enabled = true
       AND module IN (${sql.join(allRuleModules.map((m) => sql`${m}`), sql`, `)})
     ORDER BY name
  `)).rows as Array<{ id: string; name: string; module: string }> : [];

  const sopRows = (await tx.execute(sql`
    SELECT id, title FROM sops WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL ORDER BY title
  `)).rows as Array<{ id: string; title: string }>;

  const measures = await runAllMeasures(tx, tenantId, PRACTICE_PROCESSES.map((p) => p.measure));

  const holdersByPos = new Map<string, Array<{ userId: string; name: string }>>();
  for (const h of holders) {
    const list = holdersByPos.get(h.position_id) ?? [];
    list.push({ userId: h.user_id, name: h.name });
    holdersByPos.set(h.position_id, list);
  }
  const posById = new Map(positions.map((p) => [p.id, p]));
  const settingByKey = new Map(settings.map((s) => [s.process_key, s]));
  // First row per recipe wins: the enabled one, else the latest edited.
  const wfByRecipe = new Map<string, { id: string; enabled: boolean; published: boolean }>();
  for (const w of wfs) {
    if (!wfByRecipe.has(w.recipe_key)) wfByRecipe.set(w.recipe_key, { id: w.id, enabled: !!w.enabled, published: !!w.published });
  }

  const rows: SystemsMapRow[] = PRACTICE_PROCESSES.map((p) => {
    const sops: MapSop[] = links
      .filter((l) => linkDocumentsProcess(p, { targetKind: l.target_kind, targetKey: l.target_key }))
      .map((l) => ({ sopId: l.sop_id, title: l.title, linkId: l.id, via: l.target_kind, targetKey: l.target_key }));

    const setting = settingByKey.get(p.key);
    const pos = setting?.owner_position_id ? posById.get(setting.owner_position_id) : undefined;
    const owner: MapOwner | null = pos ? { positionId: pos.id, title: pos.title, holders: holdersByPos.get(pos.id) ?? [] } : null;

    const recipes: MapRecipe[] = p.recipeKeys.map((k) => {
      const wf = wfByRecipe.get(k);
      return { key: k, name: recipeName(k), workflowId: wf?.id ?? null, enabled: !!wf?.enabled, published: !!wf?.published };
    });

    const rules = ruleRows
      .filter((r) => (p.ruleModules ?? []).includes(r.module))
      .map((r) => ({ id: String(r.id), name: r.name }));

    const measure = measures.get(p.measure) ?? { value: null, unit: "count" as const, label: "Not measured", hasData: false };

    return {
      key: p.key,
      name: p.name,
      outcome: p.outcome,
      defaultOwner: p.defaultOwner,
      measureKey: p.measure,
      pillars: {
        documented: sops.length > 0,
        owned: !!owner && owner.holders.length > 0,
        measured: measure.hasData,
        automated: recipes.some((r) => r.enabled) || rules.length > 0,
      },
      sops,
      owner,
      notes: setting?.notes ?? null,
      measure,
      recipes,
      rules,
    };
  });

  return {
    rows,
    score: scoreProcesses(rows),
    positions: positions.map((p) => ({ id: p.id, title: p.title, holders: holdersByPos.get(p.id)?.length ?? 0 })),
    sops: sopRows,
  };
}
