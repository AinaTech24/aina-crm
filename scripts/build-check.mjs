/**
 * `npm run build:check` — a production build that CANNOT break your dev server.
 *
 * Running `next build` while `npm run dev` is up writes both processes into the
 * same `.next`. They race on the build manifest, the dev server starts throwing
 * ENOENT on `_buildManifest.js.tmp.*`, and the build itself fails with a
 * misleading `Cannot find module for page: /api/…`. That has now happened twice
 * in this repo, both times losing a dev server, so the guard lives in a script
 * rather than in whoever remembers the flag.
 *
 * Three things it does that a bare `next build` does not:
 *   1. builds into `.next-verify`, never `.next`;
 *   2. removes that directory afterwards, pass or fail;
 *   3. restores `tsconfig.json`, because Next REWRITES it on every build to add
 *      `<distDir>/types/**\/*.ts` to `include` — leaving a dangling path that
 *      then makes `tsc --noEmit` fail with TS6053 on files that don't exist.
 *
 * Use this for "does it compile for production?". Use plain `next build` only
 * when nothing else is running.
 */

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const DIST = ".next-verify";

const result = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_DIST_DIR: DIST },
});

// Clean up whatever happened — a failed build leaves the directory too.
try {
  rmSync(DIST, { recursive: true, force: true });
} catch {
  /* best effort; the directory is gitignored either way */
}

// `next build` adds the dist dir's types to tsconfig include. Ours is
// temporary, so the entry would outlive the folder and break typechecking.
const git = spawnSync("git", ["checkout", "--", "tsconfig.json"], { stdio: "ignore" });
if (git.status !== 0) {
  console.warn("[build:check] could not restore tsconfig.json — check `git diff tsconfig.json`");
}

process.exit(result.status ?? 1);
