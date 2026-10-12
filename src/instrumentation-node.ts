/**
 * Node-only part of the server start hook (see instrumentation.ts): the web
 * process's database role check. In production a missing APP_DATABASE_URL or
 * a privileged role ends the process with non-secret diagnostics; outside
 * production it only warns (runtime-role.ts).
 */
export async function checkWebDatabase(): Promise<void> {
  try {
    const { assertRuntimeDatabase } = await import("@/db/client");
    const role = await assertRuntimeDatabase("web");
    if (process.env.DB_QUIET !== "1") console.log(`[web] database role '${role.role}' verified (restricted; no privileged fallback).`);
  } catch (err) {
    console.error(`[web] refusing to start: ${(err as Error)?.message ?? err}`);
    process.exit(1);
  }
}
