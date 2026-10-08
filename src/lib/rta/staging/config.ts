/**
 * RTA_PIPELINE_MODE — which import engine(s) run on an RTA file.
 *
 *   off     the existing importer only (the default; also what an unset or
 *           unreadable value means)
 *   shadow  the existing importer, THEN the staging pipeline reads the same
 *           file into rta_staging_* — parse, validate, match, group, reconcile
 *           — and posts NOTHING to any financial table
 *   validate_first  (Phase 3F, DEVELOPMENT ONLY) the staging pipeline runs
 *           FIRST and the existing importer does NOT run; eligible records
 *           post through lib/rta/posting. Granted only when the posting gate
 *           (lib/rta/posting/gate.ts) passes; otherwise the import is refused
 *           outright ("validate_first_refused") — it never falls back to the
 *           existing importer writing unvalidated records.
 *   on      reserved for a later, explicitly approved release. Refused here:
 *           it is treated as off and reported, never as shadow-plus-posting.
 *
 * RTA_PIPELINE_TENANTS (optional, comma-separated tenant ids) limits shadow to
 * those firms, so a rollout can start with one.
 *
 * Rollback is setting the flag back to off. Nothing reads the staging tables
 * for a business figure, so turning shadow off changes no screen.
 */
import { postingGateEnv } from "../posting/gate";

export type RtaPipelineMode = "off" | "shadow" | "validate_first" | "validate_first_refused";

export type ModeDecision = { mode: RtaPipelineMode; refused?: string };

export function rtaPipelineMode(tenantId?: string, env: NodeJS.ProcessEnv = process.env): ModeDecision {
  const raw = (env.RTA_PIPELINE_MODE ?? "").trim().toLowerCase();
  if (raw === "on") {
    return { mode: "off", refused: "RTA_PIPELINE_MODE=on is reserved for a later approved release — running the existing importer only" };
  }
  const allow = (env.RTA_PIPELINE_TENANTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const inScope = !allow.length || (!!tenantId && allow.includes(tenantId));
  if (raw === "validate_first") {
    if (!inScope) return { mode: "off" };
    const gate = postingGateEnv(env);
    return gate.allowed ? { mode: "validate_first" } : { mode: "validate_first_refused", refused: `validate-first requested but the posting gate refused: ${gate.reasons.join("; ")}` };
  }
  if (raw !== "shadow") return { mode: "off", refused: raw && raw !== "off" ? `RTA_PIPELINE_MODE="${raw}" is not a mode — running the existing importer only` : undefined };
  if (!inScope) return { mode: "off" };
  return { mode: "shadow" };
}

/**
 * The mode for one firm, with the database controls (Phase 3G). This is what
 * every import path asks; the env-only rtaPipelineMode above is its
 * process-level part.
 *
 *   RTA_PIPELINE_MODE is the process CEILING: off · shadow · validate_first.
 *
 *   RTA_POSTING_MODE=controlled — the firm's activation decides:
 *     no activation / off   → off (the existing importer, as today)
 *     shadow                → shadow if the ceiling allows it, else off
 *     validate_first        → validate_first only when the ceiling is
 *                             validate_first, posting is enabled and nothing
 *                             is halted; otherwise validate_first_refused
 *
 *   Any other posting mode — the env decision above, except that a firm whose
 *   current activation is validate_first is NEVER sent to the existing
 *   importer: anything short of validate-first is validate_first_refused.
 *   Once a firm posts through validate-first, the existing importer writing
 *   the same files again would be a second source of the same transactions.
 *
 * A refused decision fails the import with the reason and keeps the file; it
 * is never a fallback. Moving a firm back to the existing importer is a new
 * activation row (mode off), decided by an operator.
 */
export async function resolvePipelineMode(tenantId: string, env: NodeJS.ProcessEnv = process.env): Promise<ModeDecision> {
  const { withTenant } = await import("@/db/client");
  const { currentActivation, haltState } = await import("../posting/controls");
  const { activation, halt } = await withTenant(tenantId, async (tx) => ({
    activation: await currentActivation(tx, tenantId),
    halt: await haltState(tx, tenantId),
  }));
  const ceiling = (env.RTA_PIPELINE_MODE ?? "").trim().toLowerCase();
  const refuse = (why: string): ModeDecision => ({ mode: "validate_first_refused", refused: why });
  const vfReady = (): ModeDecision => {
    const gate = postingGateEnv(env);
    if (!gate.allowed) return refuse(`validate-first requested but the posting gate refused: ${gate.reasons.join("; ")}`);
    if (halt.halted) return refuse(halt.reasons.join("; "));
    return { mode: "validate_first" };
  };
  if ((env.RTA_POSTING_MODE ?? "") === "controlled") {
    if (!activation || activation.mode === "off") return { mode: "off" };
    if (activation.mode === "shadow") return ceiling === "shadow" || ceiling === "validate_first" ? { mode: "shadow" } : { mode: "off" };
    if (ceiling !== "validate_first") return refuse(`this firm is activated for validate-first but the process allows only "${ceiling || "off"}" — the import is held, not sent to the existing importer`);
    if (!activation.postingEnabled) return refuse("this firm is activated for validate-first without posting enabled — the import is held");
    return vfReady();
  }
  const d = rtaPipelineMode(tenantId, env);
  if (d.mode === "validate_first") return vfReady();
  if (activation?.mode === "validate_first" && d.mode !== "validate_first_refused") {
    return refuse("this firm is activated for validate-first; the existing importer will not run for it");
  }
  return d;
}

/** Bumped whenever normalization or grouping changes what a row stages as. */
export const STAGING_PARSER_VERSION = "rta-staging/1.0.0";

/** A file with more data rows than this is refused, not half-read. */
export const STAGING_MAX_ROWS = Number(process.env.RTA_STAGING_MAX_ROWS ?? 250_000);

/** Rows written per INSERT. */
export const STAGING_CHUNK = 500;

/** How long a worker holds a batch before another may take it over. */
export const STAGING_LEASE_MS = Number(process.env.RTA_STAGING_LEASE_MS ?? 10 * 60_000);
