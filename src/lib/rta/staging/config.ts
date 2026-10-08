/**
 * RTA_PIPELINE_MODE — which import engine(s) run on an RTA file.
 *
 *   off     the existing importer only (the default; also what an unset or
 *           unreadable value means)
 *   shadow  the existing importer, THEN the staging pipeline reads the same
 *           file into rta_staging_* — parse, validate, match, group, reconcile
 *           — and posts NOTHING to any financial table
 *   on      reserved for a later, explicitly approved release. Refused here:
 *           it is treated as off and reported, never as shadow-plus-posting.
 *
 * RTA_PIPELINE_TENANTS (optional, comma-separated tenant ids) limits shadow to
 * those firms, so a rollout can start with one.
 *
 * Rollback is setting the flag back to off. Nothing reads the staging tables
 * for a business figure, so turning shadow off changes no screen.
 */
export type RtaPipelineMode = "off" | "shadow";

export type ModeDecision = { mode: RtaPipelineMode; refused?: string };

export function rtaPipelineMode(tenantId?: string, env: NodeJS.ProcessEnv = process.env): ModeDecision {
  const raw = (env.RTA_PIPELINE_MODE ?? "").trim().toLowerCase();
  if (raw === "on") {
    return { mode: "off", refused: "RTA_PIPELINE_MODE=on is reserved for a later approved release — running the existing importer only" };
  }
  if (raw !== "shadow") return { mode: "off", refused: raw && raw !== "off" ? `RTA_PIPELINE_MODE="${raw}" is not a mode — running the existing importer only` : undefined };
  const allow = (env.RTA_PIPELINE_TENANTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length && (!tenantId || !allow.includes(tenantId))) return { mode: "off" };
  return { mode: "shadow" };
}

/** Bumped whenever normalization or grouping changes what a row stages as. */
export const STAGING_PARSER_VERSION = "rta-staging/1.0.0";

/** A file with more data rows than this is refused, not half-read. */
export const STAGING_MAX_ROWS = Number(process.env.RTA_STAGING_MAX_ROWS ?? 250_000);

/** Rows written per INSERT. */
export const STAGING_CHUNK = 500;

/** How long a worker holds a batch before another may take it over. */
export const STAGING_LEASE_MS = 10 * 60_000;
