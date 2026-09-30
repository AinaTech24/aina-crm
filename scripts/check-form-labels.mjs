/**
 * Orphan-`<label>` ratchet.
 *
 * A `<label>` is only wired to its control if it carries `htmlFor` or WRAPS the
 * control. A UI audit on 2026-09-21 found 222 labels (by a crude count; 113 once wrapped custom controls were recognised) with
 * neither — including Add client, New family, Document upload and Accept
 * invite. Clicking those labels does nothing, and a screen reader announces an
 * unnamed box. Separately, almost nothing in the app renders `aria-invalid` or
 * `role="alert"`, so validation errors are not announced either.
 *
 * `src/components/ui/Field.tsx` is the fix for new code: it generates the id,
 * wires `htmlFor`, and owns the hint and error slots.
 *
 * This is a RATCHET, not a ban — CI fails only if the orphan count GROWS.
 * Lower BASELINE as forms migrate.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";

/** Count as of the 2026-09-21 audit. Ratchet DOWN; never up. */
const BASELINE = 112;

const LABEL = /<label\b([^>]*)>([\s\S]*?)<\/label>/g;
// A label that WRAPS a control is associated implicitly — and here the control
// is often a local helper (`<Sel>`, `<Field>`, `<RmSelector>`,
// `<ImageUploadInput>`) that renders the real input inside. Any capitalised
// component whose name says it is an input counts, as does a native one.
const CONTROL = /<(input|textarea|select|Sel\b|Select\b|[A-Z]\w*(?:Field|Select|Selector|Input|Picker|Lookup|Upload|Editor|Toggle|Switch|Checkbox|Radio|Date|Time|Textarea|Combobox|Dropdown)\b)/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (entry.endsWith(".tsx")) yield p;
  }
}

let orphans = 0;
const worst = [];

for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  let n = 0;
  for (const m of src.matchAll(LABEL)) {
    const [, attrs, body] = m;
    if (attrs.includes("htmlFor")) continue; // explicitly associated
    if (CONTROL.test(body)) continue; // implicitly associated by wrapping
    n++;
  }
  if (n) {
    orphans += n;
    worst.push([n, file]);
  }
}

worst.sort((a, b) => b[0] - a[0]);

console.log(`[check-form-labels] labels with neither htmlFor nor a wrapped control: ${orphans}`);

if (orphans > BASELINE) {
  console.error(`[check-form-labels] FAIL — count grew above the baseline of ${BASELINE}.`);
  console.error("Use <Field> from @/components/ui/Field, or wrap the control in its <label>.");
  for (const [n, f] of worst.slice(0, 15)) console.error(`  ${String(n).padStart(3)}  ${f}`);
  process.exit(1);
}

if (orphans < BASELINE) {
  console.log(`[check-form-labels] OK — ${BASELINE - orphans} fewer than the baseline. Lower BASELINE to ${orphans}.`);
} else {
  console.log(`[check-form-labels] OK (baseline ${BASELINE})`);
}
