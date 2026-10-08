/**
 * Timing of the RTA import job and of the reaper that cleans up after it —
 * derived from ONE setting so they cannot disagree again.
 *
 * They did: the job was allowed 180 minutes (a since-inception CAMS WBR2 is
 * ~500k rows) while the reaper failed any row still `parsing` after 60, so a
 * long import that was still running showed "failed — the worker restarted"
 * for two hours, then flipped to completed when it finished. Worse, the inbox
 * poller's in-flight check stopped seeing the row once it read `failed`, so a
 * re-forwarded copy was queued behind it.
 *
 * The reaper now waits the job timeout plus a margin: by then the job has
 * either finished (and written its own terminal status) or been abandoned by
 * `withJobTimeout`, so a row still `parsing` really is orphaned.
 */

export type RtaJobTiming = {
  /** Hard ceiling on one import job. */
  jobTimeoutMin: number;
  /** A row still `parsing` this long after it started is reaped as failed. */
  reapParsingAfterMin: number;
};

/** Extra time past the job timeout before a `parsing` row counts as orphaned. */
export const REAP_MARGIN_MIN = 30;

export function rtaJobTiming(env: Record<string, string | undefined> = process.env): RtaJobTiming {
  const raw = Number(env.RTA_JOB_TIMEOUT_MIN ?? 180);
  const jobTimeoutMin = Number.isFinite(raw) && raw > 0 ? raw : 180;
  return { jobTimeoutMin, reapParsingAfterMin: Math.ceil(jobTimeoutMin) + REAP_MARGIN_MIN };
}
