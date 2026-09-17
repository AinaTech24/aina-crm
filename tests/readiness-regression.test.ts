import { describe, expect, it } from "vitest";
import { workersHealthy, REQUIRED_WORKERS, type WorkerHeartbeat } from "@/lib/platform/worker-health";
import { buildProductReadiness } from "@/lib/platform/product-readiness";
describe("readiness uses current evidence", () => {
  const now = Date.parse("2026-09-09T10:00:00Z");
  const rows = (): WorkerHeartbeat[] => REQUIRED_WORKERS.map((name) => ({ job_name: `worker:${name}`, last_run_status: "ok", last_heartbeat_at: new Date(now - 10_000) }));
  it("requires all expected loops, including workers that have never started", () => {
    expect(workersHealthy([], now)).toBeNull();
    expect(workersHealthy(rows().slice(1), now)).toBeNull();
    expect(workersHealthy(rows(), now)).toBe(true);
  });
  it("rejects error, missing timestamps and stale heartbeats at the loop cadence", () => {
    for (const patch of [{ last_run_status: "error" }, { last_heartbeat_at: null }, { last_heartbeat_at: new Date(now - 6 * 60_000) }]) {
      const input = rows(); input[0] = { ...input[0], ...patch };
      expect(workersHealthy(input, now)).toBe(false);
    }
  });
  it("does not turn unknown runtime health into configured/live", () => {
    const items = buildProductReadiness({ tenantProviders: new Set(), workerHealthy: null, lastRtaImportAt: null });
    for (const key of ["database", "workers", "redis"]) expect(items.find((item) => item.key === key)?.status).toBe("unknown");
  });
});
