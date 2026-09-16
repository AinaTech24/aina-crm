export const REQUIRED_WORKERS = ["outbox", "workflow", "scheduler", "campaigns", "scheduled-comms", "workflow-rules"] as const;
export type WorkerHeartbeat = { job_name: string; last_run_status: string | null; last_heartbeat_at: string | Date | null };
/** Fast loops must prove recent successful work, including successful empty polls. */
export function workersHealthy(rows: WorkerHeartbeat[], now = Date.now(), required: readonly string[] = REQUIRED_WORKERS): boolean | null {
  const byName = new Map(rows.map((row) => [row.job_name, row]));
  if (!required.length || required.some((name) => !byName.has(`worker:${name}`))) return null;
  return required.every((name) => {
    const row = byName.get(`worker:${name}`)!;
    const age = row.last_heartbeat_at ? now - new Date(row.last_heartbeat_at).getTime() : Infinity;
    return row.last_run_status === "ok" && Number.isFinite(age) && age >= -30_000 && age < 5 * 60_000;
  });
}
