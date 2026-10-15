/**
 * G-1 browser check (2026-10-14): does any page or API response hand a user a
 * guardian they may not open — name or risk — through a minor's record?
 *
 * Run against a LOCAL dev server and a LOCAL database seeded with one firm
 * (data wall on): a minor in RM A's book linked to a guardian in RM B's book
 * (a link made before the fix), and a minor linked to a guardian in RM A's own
 * book. Sessions come from scripts/dev-session.mjs (local only, no password).
 *
 *   BASE=http://localhost:3100 RM_A=<uuid> OWNER=<uuid> MINOR_HIDDEN=<uuid> MINOR_VISIBLE=<uuid> \
 *   MINOR_HIDDEN_NAME="…" HIDDEN_NAME="…" HIDDEN_RISK=very_aggressive VISIBLE_NAME="…" HIDDEN_GUARDIAN=<uuid> \
 *   SESSION_DATABASE_URL=<local admin URL, only for minting the cookie> \
 *     node scripts/g1-guardian-ui.mjs
 *
 * Every page is checked twice: the raw document the browser receives (HTML +
 * the React Server Components payload inside it) and the rendered text.
 *
 * Since the final hardening, a MINOR's risk is the minor's own assessment for
 * everyone (the owner too); the guardian's profile appears only as the
 * guardian's, labelled, to a user who may open the guardian.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright-core")); } catch { ({ chromium } = require("/opt/node-tools/node_modules/playwright-core")); }

const env = (k) => { const v = process.env[k]; if (!v) { console.error(`missing ${k}`); process.exit(2); } return v; };
const BASE = env("BASE");
const RM_A = env("RM_A"), OWNER = env("OWNER");
const MH = env("MINOR_HIDDEN"), MV = env("MINOR_VISIBLE"), GH = env("HIDDEN_GUARDIAN");
const MINOR_HIDDEN_NAME = env("MINOR_HIDDEN_NAME");
const HIDDEN_NAME = env("HIDDEN_NAME"), HIDDEN_RISK = env("HIDDEN_RISK"), VISIBLE_NAME = env("VISIBLE_NAME");
const riskWords = [HIDDEN_RISK, HIDDEN_RISK.replace(/_/g, " "), HIDDEN_RISK.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())];

const cookieFor = (userId) => {
  // dev-session reads `users` directly, which RLS hides from the app role: give
  // it the LOCAL admin connection (SESSION_DATABASE_URL) when one is set.
  const out = execFileSync("node", ["scripts/dev-session.mjs", userId], {
    encoding: "utf8",
    env: { ...process.env, ...(process.env.SESSION_DATABASE_URL ? { DATABASE_URL: process.env.SESSION_DATABASE_URL } : {}) },
  });
  const m = out.match(/COOKIE mfd_session=(\S+)/);
  if (!m) throw new Error("dev-session printed no cookie");
  return m[1];
};

let pass = 0, fail = 0;
const check = (ok, label) => { if (ok) pass++; else fail++; console.log(`${ok ? "✓" : "✗"} ${label}`); };
const leaks = (text) => [HIDDEN_NAME, ...riskWords].filter((w) => text.includes(w));

const browser = await chromium.launch();
async function as(userId) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "mfd_session", value: cookieFor(userId), url: BASE }]);
  const page = await ctx.newPage();
  const raw = async (path) => { const r = await ctx.request.get(BASE + path); return { status: r.status(), text: await r.text() }; };
  // Everything in the live DOM: text in collapsed sections and input values too
  // (stricter than what is on screen).
  const rendered = async (path) => {
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 180_000 });
    return page.evaluate(() => document.body.textContent + "\n" + [...document.querySelectorAll("input,textarea")].map((e) => e.value).join("\n"));
  };
  const send = async (method, path, body) => {
    const r = await ctx.request.fetch(BASE + path, { method, data: body, headers: { "content-type": "application/json", origin: BASE } });
    return { status: r.status(), text: await r.text() };
  };
  return { ctx, raw, rendered, send };
}

try {
  const a = await as(RM_A);
  for (const [path, what] of [
    [`/dashboard/investors/${MH}/edit`, "edit page"],
    [`/dashboard/investors/${MH}`, "client page"],
    [`/dashboard/risk-profiles?filter=current,not_profiled,due,expired,awaiting`, "risk profiles list"],
    [`/dashboard/investors`, "client list"],
  ]) {
    const r = await a.raw(path);
    check(r.status === 200, `RM A ${what}: ${r.status}`);
    if (what === "client list") {
      // Filter menus list the firm's categories; the guardian's name is the leak.
      check(!r.text.includes(HIDDEN_NAME), `RM A ${what} document never names the hidden guardian`);
      check(r.text.includes(MINOR_HIDDEN_NAME), `RM A ${what} shows the minor (the page ran)`);
    } else if (what === "risk profiles list") {
      // The page also carries the firm's age-band settings, which name every
      // category — so check the minor's own row, and the guardian's name anywhere.
      check(!r.text.includes(HIDDEN_NAME), `RM A ${what} document never names the hidden guardian`);
      const row = r.text.match(new RegExp(`name\\\\?":\\\\?"${MINOR_HIDDEN_NAME}\\\\?".*?risk_profile\\\\?":(null|\\\\?"[a-z_]+)`));
      check(!!row && row[1] === "null", `RM A ${what}: the minor's row carries no risk (${row ? row[1] : "row not found"})`);
      const grow = r.text.match(new RegExp(`name\\\\?":\\\\?"${MINOR_HIDDEN_NAME}\\\\?".*?guardian_risk_profile\\\\?":(null|\\\\?"[a-z_]+)`));
      check(!!grow && grow[1] === "null", `RM A ${what}: no guardian's profile beside the minor (${grow ? grow[1] : "row not found"})`);
    } else {
      check(leaks(r.text).length === 0, `RM A ${what} document carries no hidden guardian name / risk (${leaks(r.text).join(", ") || "none"})`);
    }
    const t = await a.rendered(path);
    check(!/license is|no_subscription/i.test(t), `RM A ${what} renders the page itself (not a licence block)`);
    const tl = what === "risk profiles list" || what === "client list" ? (t.includes(HIDDEN_NAME) ? [HIDDEN_NAME] : []) : leaks(t);
    check(tl.length === 0, `RM A ${what} rendered DOM carries none (${tl.join(", ") || "none"})`);
    if (what === "edit page") check(t.includes("outside your book"), "RM A edit page says the guardian is outside their book");
  }
  const api = await a.raw(`/api/investors/${MH}`);
  check(api.status === 200 && leaks(api.text).length === 0, `RM A GET /api/investors/<minor>: ${api.status}, leaks ${leaks(api.text).join(", ") || "none"}`);
  check(JSON.parse(api.text).investor?.riskProfile === null, "RM A API: the minor's copied risk is null");
  const g = await a.raw(`/api/investors/${GH}`);
  check(g.status === 403 || g.status === 404, `RM A cannot open the guardian directly (${g.status})`);
  // The change history follows the client's own access; a minor's carries no copy.
  const ga = await a.raw(`/api/audit?entityType=investor&entityId=${GH}`);
  check(ga.status === 404 && !ga.text.includes(HIDDEN_NAME), `RM A cannot read the guardian's history by id (${ga.status})`);
  const ma = await a.raw(`/api/audit?entityType=investor&entityId=${MH}`);
  check(ma.status === 200 && leaks(ma.text).length === 0, `RM A minor's history: ${ma.status}, leaks ${leaks(ma.text).join(", ") || "none"}`);
  const list = await a.raw(`/api/investors?limit=200`);
  check(list.status === 200 && leaks(list.text).length === 0 && list.text.includes(MH), `RM A GET /api/investors: ${list.status}, leaks ${leaks(list.text).join(", ") || "none"}`);

  const pick = await a.send("PATCH", `/api/investors/${MV}`, { guardianInvestorId: GH });
  check(pick.status === 400 && leaks(pick.text).length === 0, `RM A linking the hidden guardian by id is refused without detail (${pick.status})`);
  const vis = await a.raw(`/dashboard/investors/${MV}/edit`);
  check(vis.text.includes(VISIBLE_NAME), "RM A edit page of the in-book minor still names its in-book guardian");

  // Dashboards and the proposal form (2026-10-15): the RM's own desk, and the
  // Branch Head Dashboard of the minor's branch (the hidden guardian is in
  // another branch; the minor's row still carries the guardian's 0234 copy).
  const pages = [[a, "RM A", "/dashboard", "RM dashboard"], [a, "RM A", `/dashboard/proposals/new?investorId=${MH}`, "new proposal form"]];
  const BH = process.env.BRANCH_HEAD;
  if (BH) pages.push([await as(BH), "branch head", "/dashboard", "Branch Head dashboard"]);
  for (const [who, label, path, what] of pages) {
    const r = await who.raw(path);
    check(r.status === 200, `${label} ${what}: ${r.status}`);
    check(leaks(r.text).length === 0, `${label} ${what} document carries no hidden guardian name / risk (${leaks(r.text).join(", ") || "none"})`);
    const t = await who.rendered(path);
    check(!/license is|no_subscription/i.test(t), `${label} ${what} renders the page itself (not a licence block)`);
    const tl = leaks(t);
    check(tl.length === 0, `${label} ${what} rendered DOM carries none (${tl.join(", ") || "none"})`);
    const must = { "Branch Head dashboard": "Branch", "RM dashboard": "UI RM A", "new proposal form": MINOR_HIDDEN_NAME }[what];
    check(t.includes(must), `${label} ${what} is the real page (shows "${must}")`);
  }

  // A minor whose typed guardian PAN linked nobody (incomplete onboarding).
  const MP = process.env.MINOR_PENDING;
  if (MP) {
    const t = await a.rendered(`/dashboard/investors/${MP}`);
    check(t.includes("Guardian not verified"), "RM A client page of a minor with an unlinked guardian says \"Guardian not verified\"");
    check(!t.includes("Confirm guardian"), "RM A is not offered \"Confirm guardian\"");
    const st = await a.raw(`/api/investors/${MP}/guardian-verification`);
    check(st.status === 200 && JSON.parse(st.text).status === "pending", `RM A reads the status: ${st.text}`);
    const self = await a.send("POST", `/api/investors/${MP}/guardian-verification`, { note: "I checked it myself, honestly." });
    check(self.status === 403, `RM A cannot confirm the guardian (${self.status})`);
    const ot = await (await as(OWNER)).rendered(`/dashboard/investors/${MP}`);
    check(ot.includes("Guardian not verified") && ot.includes("Confirm guardian"), "the owner sees the status and the \"Confirm guardian\" action");
  }

  const o = await as(OWNER);
  const od = await o.raw(`/dashboard/investors/${MH}/edit`);
  check(od.text.includes(HIDDEN_NAME), "the owner (whole book) is shown the guardian's name");
  const oapi = JSON.parse((await o.raw(`/api/investors/${MH}`)).text);
  check(oapi.investor?.riskProfile === null, "the owner too: the minor's risk is its own assessment (none yet), never the guardian's copy");
  const ot = await o.rendered(`/dashboard/investors/${MH}/edit`);
  check(ot.includes("Guardian's own risk profile") && ot.includes("Very aggressive") && ot.includes("Not recorded for this account yet"),
    "the owner's edit page shows the guardian's profile as the guardian's, beside the minor's own (none)");
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
