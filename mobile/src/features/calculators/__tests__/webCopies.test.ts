/**
 * Every module in ../web is the web CRM's maths, copied verbatim by
 * web/sync-from-web.mjs. This checks each copy exports exactly what its web
 * module exports — a renamed or added web function means the copy is stale:
 * re-run `node mobile/src/features/calculators/web/sync-from-web.mjs`.
 * (Each calculator's own test compares the FIGURES of copy and web.)
 */

import { webModule } from "../testing/webModules";

const nodeRequire: any = require;
const fs = nodeRequire("fs");
const path = nodeRequire("path");
declare const __dirname: string;

const COPIES = path.resolve(__dirname, "../web");
const pairs: Array<[string, string]> = [
  ...fs.readdirSync(COPIES)
    .filter((f: string) => f.endsWith(".ts") && f !== "format.ts" && f !== "goal-planning-calc.ts")
    .map((f: string): [string, string] => [f, `calculators/${f.slice(0, -3)}`]),
  ["goal-planning-calc.ts", "goal-planning/calc"],
  ...fs.readdirSync(path.join(COPIES, "fund-research"))
    .filter((f: string) => f.endsWith(".ts"))
    .map((f: string): [string, string] => [`fund-research/${f}`, `fund-research/${f.slice(0, -3)}`]),
];

describe("web copies", () => {
  it.each(pairs)("%s exports what src/lib/%s exports", (copy, rel) => {
    const app = nodeRequire(path.join(COPIES, copy));
    const web = webModule(rel);
    expect(Object.keys(app).sort()).toEqual(Object.keys(web).sort());
  });
  it("the shared goal-planning maths gives the web's figures", () => {
    const app = nodeRequire(path.join(COPIES, "goal-planning-calc"));
    const web = webModule("goal-planning/calc");
    for (const [p, r, n] of [[10000, 12, 120], [2500, 9.5, 37], [0, 12, 60], [5000, 0, 24]]) {
      expect(app.fvSip(p, r, n)).toBe(web.fvSip(p, r, n));
      expect(app.requiredSip(5_000_000, p * 10, r, n)).toBe(web.requiredSip(5_000_000, p * 10, r, n));
    }
  });
});
