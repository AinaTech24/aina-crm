/**
 * Next.js server start hook. On the Node runtime, the web server verifies its
 * database role BEFORE serving (final security patch): production refuses to
 * start without APP_DATABASE_URL or with a privileged role (instrumentation-node).
 * The Edge runtime has no database connection.
 *
 * The import must sit inside a literal `process.env.NEXT_RUNTIME === "nodejs"`
 * branch: Next compiles this file for the Edge runtime too, and only that exact
 * condition lets the bundler drop the Node-only module (pg, fs) from the Edge
 * build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { checkWebDatabase } = await import("./instrumentation-node");
    await checkWebDatabase();
  }
}
