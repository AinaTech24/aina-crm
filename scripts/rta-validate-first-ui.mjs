#!/usr/bin/env node
/**
 * Browser check for the validate-first RTA screens (Phase 3F) — run against a
 * DEVELOPMENT server on an isolated database after an import has posted.
 * Real Chromium, real hydration, real clicks; never a production URL.
 *
 *   BASE_URL=http://localhost:3100 COOKIE='mfd_session=…' INVESTOR_ID=<uuid> \
 *   EXPECT_JSON='{"activeSips":12,"held":34,"resolvable":5}' node scripts/rta-validate-first-ui.mjs
 *
 * COOKIE comes from scripts/dev-session.mjs. EXPECT_JSON carries the figures
 * the database says the screens must show (counts only). The script prints
 * counts and pass/fail lines — never a client's name, PAN or folio.
 *
 * Checks:
 *   1. Owner Dashboard — the AUM tile names the registrar statements behind it;
 *      the Registrar AUM card renders.
 *   2. Client portfolio — registrar captions on holdings and the statement
 *      coverage line.
 *   3. SIP Book — the Active SIPs figure equals the database's.
 *   4. Held transactions — one row per held registrar transaction, a
 *      "Choose client" button exactly where a person can settle it; choosing a
 *      client the registrar contradicts is refused by the server and nothing
 *      changes.
 *   5. Row exceptions links to Held transactions.
 *   6. No page scrolls sideways at 375px; no uncaught page errors.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright-core")); } catch { ({ chromium } = require("/opt/node-tools/node_modules/playwright-core")); }

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error("BASE_URL must be a local development server"); process.exit(2); }
const [cName, ...cRest] = (process.env.COOKIE ?? "").split("=");
if (!cName || !cRest.length) { console.error("COOKIE=name=value is required (scripts/dev-session.mjs)"); process.exit(2); }
const EXPECT = JSON.parse(process.env.EXPECT_JSON ?? "{}");
const INVESTOR = process.env.INVESTOR_ID;

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addCookies([{ name: cName, value: cRest.join("="), domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 160)));
const go = async (path) => { const r = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 180_000 }); return r?.status() ?? 0; };

// 1. Owner Dashboard
let status = await go("/dashboard");
check("owner dashboard loads", status === 200 && !page.url().includes("/login"), `HTTP ${status}`);
const aumTile = page.locator(".dash-kpi").filter({ hasText: /^AUM/ }).first();
const tileText = (await aumTile.innerText().catch(() => "")) ?? "";
check("AUM tile names the registrar statements behind it", /Registrar statements: /.test(tileText), tileText.match(/Registrar statements:.*/)?.[0] ?? "no footer");
if (EXPECT.aumWarn != null) check("AUM tile warns when a statement is stale / partial / mixed", (await aumTile.locator(".text-warning-foreground").count()) > 0 === EXPECT.aumWarn);
const regCard = page.getByText("Registrar statements (firm total)");
check("Registrar AUM card renders", (await regCard.count()) > 0);

// 2. Client portfolio
if (INVESTOR) {
  status = await go(`/dashboard/investors/${INVESTOR}?tab=portfolio`);
  check("client page loads", status === 200, `HTTP ${status}`);
  const portfolioTab = page.getByRole("tab", { name: /Portfolio/ }).or(page.getByRole("link", { name: /^Portfolio/ })).first();
  if (await portfolioTab.count()) { await portfolioTab.click().catch(() => {}); await page.waitForLoadState("networkidle"); }
  const captions = await page.locator("text=/^Registrar (₹|—)/").count();
  check("holdings carry the registrar's dated figure", captions >= (EXPECT.registrarCaptions ?? 1), `${captions} captions`);
  const note = await page.locator("text=/Registrar statements? dated/").first().innerText().catch(() => "");
  check("portfolio states which statements it rests on", !!note, note.replace(/\d{5,}/g, "#"));
}

// 3. SIP Book
status = await go("/dashboard/sips");
check("SIP Book loads", status === 200, `HTTP ${status}`);
const activeStat = page.locator("text=Active SIPs").first().locator("xpath=ancestor::*[contains(@class,'card') or contains(@class,'stat')][1]");
const activeText = (await activeStat.innerText().catch(() => "")) ?? "";
const shown = Number((activeText.match(/([\d,]+)/)?.[1] ?? "").replace(/,/g, ""));
if (EXPECT.activeSips != null) check("Active SIPs equals the database (verified registrations only)", shown === EXPECT.activeSips, `shown ${shown}, expected ${EXPECT.activeSips}`);

// 4. Held transactions
status = await go("/dashboard/rta-imports/held");
check("Held transactions loads", status === 200, `HTTP ${status}`);
const rows = await page.locator("tbody tr").count();
if (EXPECT.held != null) check("one row per held registrar transaction", rows === Math.min(EXPECT.held, 500), `${rows} rows, expected ${EXPECT.held}`);
const buttons = page.getByRole("button", { name: "Choose client" });
const nButtons = await buttons.count();
if (EXPECT.resolvable != null) check("'Choose client' only where a person can settle it", nButtons === Math.min(EXPECT.resolvable, 500), `${nButtons} buttons, expected ${EXPECT.resolvable}`);
if (nButtons && EXPECT.searchText) {
  await buttons.first().click();
  const form = page.getByTestId("resolve-form");
  await form.locator("input").fill(EXPECT.searchText);
  const option = form.locator("ul button").first();
  await option.waitFor({ timeout: 15_000 }).catch(() => {});
  if (await option.count()) {
    await option.click();
    await form.locator("textarea").fill("browser check: a client the registrar contradicts");
    const [resp] = await Promise.all([page.waitForResponse((r) => r.url().includes("/resolve"), { timeout: 30_000 }), form.getByRole("button", { name: "Post to this client" }).click()]);
    check("the server re-checks the choice and refuses a contradicted client", resp.status() === 409, `HTTP ${resp.status()}`);
    await page.reload({ waitUntil: "networkidle" });
    check("nothing changed after a refused choice", (await page.locator("tbody tr").count()) === rows);
  } else check("client search returns results in the resolve form", false);
}

// 5. Row exceptions → Held transactions
status = await go("/dashboard/rta-imports/exceptions");
check("Row exceptions links to Held transactions", (await page.getByRole("link", { name: "Held transactions" }).count()) > 0, `HTTP ${status}`);

// 6. Phone width
await page.setViewportSize({ width: 375, height: 800 });
for (const path of ["/dashboard/rta-imports/held", "/dashboard/sips", ...(INVESTOR ? [`/dashboard/investors/${INVESTOR}?tab=portfolio`] : [])]) {
  await go(path);
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no sideways scroll at 375px: ${path.replace(/[0-9a-f-]{36}/, ":id")}`, w <= 376, `scrollWidth ${w}`);
}
check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
