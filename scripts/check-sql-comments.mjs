/**
 * `npm run check:sql` — catch backticks inside SQL template literals.
 *
 * ── The bug this exists for ─────────────────────────────────────────────────
 *
 * A `sql` tagged template is a JavaScript template literal, so the first
 * backtick inside it ENDS the literal. Write a normal-looking SQL comment:
 *
 *     const q = sql`
 *       -- `follow_up_task_created` is TEXT, not boolean
 *       SELECT ...
 *     `;
 *
 * ...and the literal closes at the backtick before `follow_up_task_created`.
 * The parser then meets a bare identifier and reports:
 *
 *     ERROR: Expected ")" but found "follow_up_task_created"
 *
 * which points at a SQL column name and sends you reading the query, not the
 * quoting. It has cost two debugging rounds in this repo. `tsc` and esbuild do
 * catch it eventually — the problem is purely that the message misdirects — so
 * this check exists to name the real cause immediately.
 *
 * The rule is narrow on purpose: a line whose first non-space characters are
 * `--` and which contains a backtick. In TypeScript that shape is essentially
 * always a SQL comment, so the check has no realistic false positive and needs
 * no parser.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A hand-rolled walk rather than `fs.globSync`: that export only exists from
// Node 22, and CI (and the Docker image) run Node 20. Importing it there is a
// hard SyntaxError at module load, which fails `npm test`, which makes CI red,
// which makes deploy.yml SKIP the deploy — silently, with production left on
// the old build. A check that breaks the pipeline it guards is worse than none.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk("src");

let bad = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("sql`")) continue;
  text.split("\n").forEach((line, i) => {
    if (/^\s*--/.test(line) && line.includes("`")) {
      bad++;
      console.error(`${file}:${i + 1}  backtick inside a SQL comment — it closes the template literal`);
      console.error(`    ${line.trim()}`);
    }
  });
}

if (bad > 0) {
  console.error(
    `\n[check:sql] ${bad} backtick${bad === 1 ? "" : "s"} inside SQL comments.\n` +
      `Write the identifier bare: "-- follow_up_task_created is TEXT", not "-- \`follow_up_task_created\` is TEXT".`,
  );
  process.exit(1);
}

console.log(`[check:sql] ✓ no backticks inside SQL comments (${files.length} files scanned)`);
