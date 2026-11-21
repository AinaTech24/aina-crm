/**
 * Test-only: load a WEB CRM maths module (../../../../../src/lib/…) inside the
 * app's jest, so a parity test can run the web function and the app's copy on
 * the same inputs and demand the same answer.
 *
 * The web file is compiled here with TypeScript's transpileModule (CommonJS,
 * ES2020 — no babel, so no @babel/runtime helpers: the repo root has no
 * node_modules in CI, only mobile/ is installed) and evaluated with its own
 * require: a relative import loads the sibling WEB file, an `@/lib/…` import
 * loads that WEB file too. Nothing of the app is mixed in — the module under
 * test is the CRM's, end to end.
 */

declare const __dirname: string;
// Node built-ins, typed loosely: the app's tsconfig carries no @types/node.
const nodeRequire: any = require;
const fs = nodeRequire("fs");
const path = nodeRequire("path");
const ts = nodeRequire("typescript");

export const WEB_LIB: string = path.resolve(__dirname, "../../../../../src/lib");

const cache = new Map<string, { exports: any }>();

function resolveFile(fromDir: string, id: string): string {
  const base = id.startsWith("@/lib/") ? path.join(WEB_LIB, id.slice("@/lib/".length)) : path.resolve(fromDir, id);
  for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(cand)) return cand;
  }
  throw new Error(`webModule: cannot resolve ${id} from ${fromDir}`);
}

function load(file: string): any {
  const hit = cache.get(file);
  if (hit) return hit.exports;
  const src: string = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: file,
  });
  const mod = { exports: {} as any };
  cache.set(file, mod);
  const dir = path.dirname(file);
  const req = (id: string) => {
    if (id.startsWith(".") || id.startsWith("@/lib/")) return load(resolveFile(dir, id));
    throw new Error(`webModule: ${path.relative(WEB_LIB, file)} imports ${id}, which is not pure maths`);
  };
  // eslint-disable-next-line no-new-func
  new Function("module", "exports", "require", outputText)(mod, mod.exports, req);
  return mod.exports;
}

/** The web module at src/lib/<rel> (e.g. "calculators/sip-suite"). */
export function webModule<T = any>(rel: string): T {
  return load(resolveFile(WEB_LIB, `./${rel}`)) as T;
}
