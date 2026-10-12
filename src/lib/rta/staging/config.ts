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

/**
 * off = the existing (legacy) importer · shadow = legacy + the staging pipeline
 * validating without posting · validate_first = the new pipeline only ·
 * validate_first_refused = a configuration that cannot post (the import FAILS,
 * visibly, file kept) · held = a temporary operational stop (paused, halted,
 * emergency): NOTHING is written and the job waits to run on resume.
 */
export type RtaPipelineMode = "off" | "shadow" | "validate_first" | "validate_first_refused" | "held";

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
 * The regime for one firm, with the database controls (Phases 3G–3H). Every
 * path that can write RTA-derived financial records asks this; the env-only
 * rtaPipelineMode above is its process-level part.
 *
 * In order — the first that applies wins:
 *
 *   1. EMERGENCY shutdown (scope 'emergency' halted)  → held, every firm, the
 *      existing importer included.
 *   2. The firm's own halt row                        → held.
 *   3. RTA_POSTING_HALT=1 on this process             → held (the new pipeline).
 *   4. The firm's current activation is 'paused'      → held.
 *   5. The firm HAD an activation that ended (revoked / expired) and has no
 *      current one                                    → held. A pilot firm never
 *      drifts back to the existing importer by itself; returning to it is an
 *      explicit 'off' activation, two people.
 *   6. RTA_POSTING_MODE=controlled — the activation decides:
 *        none            → off (an existing firm keeps the existing importer),
 *                          or held when RTA_LEGACY_DEFAULT=deny
 *        off             → off (explicitly permitted legacy)
 *        shadow          → shadow if RTA_PIPELINE_MODE allows it, else off
 *        validate_first  → validate_first when the ceiling is validate_first,
 *                          posting is enabled and the env gate passes
 *                          (otherwise validate_first_refused — a configuration
 *                          error, the import fails with the reason); the
 *                          global posting switch halted → held.
 *   7. Otherwise (development) the env decision, held under a global halt, and
 *      an activated validate-first firm is never sent to the existing importer.
 *
 * held is a PAUSE, not a failure: the worker parks the job (delayed, file
 * kept, row says why) and it runs when the firm is resumed.
 */
export async function resolvePipelineMode(tenantId: string, env: NodeJS.ProcessEnv = process.env): Promise<ModeDecision> {
  const { withTenant } = await import("@/db/client");
  const { controlFacts } = await import("../posting/controls");
  const f = await withTenant(tenantId, (tx) => controlFacts(tx, tenantId));
  const held = (why: string): ModeDecision => ({ mode: "held", refused: why });
  const refuse = (why: string): ModeDecision => ({ mode: "validate_first_refused", refused: why });

  if (f.emergency?.halted) return held(`EMERGENCY SHUTDOWN of all RTA imports: ${f.emergency.reason}`);
  if (f.firm?.halted) return held(`RTA imports are halted for this firm: ${f.firm.reason}`);
  if (f.current?.mode === "paused") return held(`RTA imports are paused for this firm: ${f.current.reason}`);
  if (!f.current && f.everActivated) {
    return held("this firm's RTA activation ended (revoked or expired); it stays paused until an operator records the next mode — it never returns to the existing importer by itself");
  }
  const ceiling = (env.RTA_PIPELINE_MODE ?? "").trim().toLowerCase();
  const vfReady = (): ModeDecision => {
    if ((env.RTA_POSTING_HALT ?? "") === "1") return held("RTA posting is halted on this process (RTA_POSTING_HALT=1)");
    const gate = postingGateEnv(env);
    if (!gate.allowed) return refuse(`validate-first requested but the posting gate refused: ${gate.reasons.join("; ")}`);
    if (!f.global) return held("the global posting control is missing (treated as halted)");
    if (f.global.halted) return held(`posting is halted for all firms: ${f.global.reason}`);
    return { mode: "validate_first" };
  };

  if ((env.RTA_POSTING_MODE ?? "") === "controlled") {
    if (!f.current) {
      return (env.RTA_LEGACY_DEFAULT ?? "").trim().toLowerCase() === "deny"
        ? held("this firm has no RTA activation and this process does not permit the existing importer by default (RTA_LEGACY_DEFAULT=deny)")
        : { mode: "off" };
    }
    if (f.current.mode === "off") return { mode: "off" };
    if (f.current.mode === "shadow") return ceiling === "shadow" || ceiling === "validate_first" ? { mode: "shadow" } : { mode: "off" };
    if (ceiling !== "validate_first") return refuse(`this firm is activated for validate-first but the process allows only "${ceiling || "off"}" — the import is refused, not sent to the existing importer`);
    if (!f.current.postingEnabled) return refuse("this firm is activated for validate-first without posting enabled — the import is refused");
    return vfReady();
  }
  const d = rtaPipelineMode(tenantId, env);
  if (d.mode === "validate_first" || d.mode === "validate_first_refused") {
    if ((env.RTA_POSTING_HALT ?? "") === "1") return held("RTA posting is halted on this process (RTA_POSTING_HALT=1)");
    if (d.mode === "validate_first") return vfReady();
    return d;
  }
  if (f.current?.mode === "validate_first") {
    return refuse("this firm is activated for validate-first; the existing importer will not run for it");
  }
  return d;
}

/** Thrown where an import must stop for a temporary operational reason; the worker parks the job. */
export class ImportHeldError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ImportHeldError";
  }
}

/** A decision under which nothing may be written for the firm. */
export const writesStopped = (d: ModeDecision) => d.mode === "held" || d.mode === "validate_first_refused";

/** Bumped whenever normalization or grouping changes what a row stages as. */
export const STAGING_PARSER_VERSION = "rta-staging/1.0.0";

/** A file with more data rows than this is refused, not half-read. */
export const STAGING_MAX_ROWS = Number(process.env.RTA_STAGING_MAX_ROWS ?? 250_000);

/** Rows written per INSERT. */
export const STAGING_CHUNK = 500;

/** How long a worker holds a batch before another may take it over. */
export const STAGING_LEASE_MS = Number(process.env.RTA_STAGING_LEASE_MS ?? 10 * 60_000);
