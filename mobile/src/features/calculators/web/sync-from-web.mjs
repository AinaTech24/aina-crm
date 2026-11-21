#!/usr/bin/env node
/**
 * Re-copy the web CRM's pure calculator maths into the mobile app.
 *
 *   node mobile/src/features/calculators/web/sync-from-web.mjs
 *
 * The files in this folder are VERBATIM copies of the web modules (only the
 * `@/…` import paths are rewritten to relative ones and a provenance header is
 * added), so keeping the app's figures equal to the CRM's is a re-run of this
 * script — never a hand edit. calcParity tests compare each copy against the
 * web module it came from.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");
const SKIP = new Set(["calc-pdf.ts", "assumptions.ts", "share-helpers.ts"]); // PDF / DB / fs — not maths

function rewrite(src, depth) {
  const up = depth === 0 ? "./" : "../";
  return src
    .replace(/from "@\/lib\/goal-planning\/calc"/g, `from "${up}goal-planning-calc"`)
    .replace(/from "@\/lib\/calculators\/([a-z0-9-]+)"/g, `from "${up}$1"`)
    .replace(/from "@\/lib\/format"/g, `from "${up}format"`);
}

function copy(srcRel, destRel, depth) {
  const src = fs.readFileSync(path.join(repo, srcRel), "utf8");
  const body = rewrite(src, depth);
  if (/from "@\//.test(body)) throw new Error(`${srcRel} still imports an @/ path`);
  const header = `// Copied verbatim from ${srcRel} by sync-from-web.mjs — do not edit here; change the web module and re-run.\n`;
  const out = path.join(here, destRel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, header + body.replace(/\r\n/g, "\n"));
  return destRel;
}

const done = [];
for (const f of fs.readdirSync(path.join(repo, "src/lib/calculators")).sort()) {
  if (!f.endsWith(".ts") || SKIP.has(f)) continue;
  done.push(copy(`src/lib/calculators/${f}`, f, 0));
}
done.push(copy("src/lib/goal-planning/calc.ts", "goal-planning-calc.ts", 0));
for (const f of fs.readdirSync(path.join(repo, "src/lib/fund-research")).sort()) {
  if (!f.endsWith(".ts")) continue;
  done.push(copy(`src/lib/fund-research/${f}`, `fund-research/${f}`, 1));
}
console.log(`copied ${done.length} modules`);
