/**
 * Named dashboards (dashboard cleanup D7 / D8 / D9, then the six role
 * dashboards) — the pure rules: periods in India time, filter state in the
 * URL, what a viewer's figures may count, who sees / edits / shares a
 * dashboard, the default each role opens, and that every widget on a system
 * dashboard exists. No database.
 */

import { describe, expect, it } from "vitest";
import { resolvePeriod, minusYear, fyStartOf, fiscalYearKey, formatRange } from "@/lib/dashboards/system/period";
import {
  filterStateToParams, hasFilterParams, parseFilterState, sanitizeFilterState, activeFilterKeys,
} from "@/lib/dashboards/system/filters";
import { dataAccessFor, scopeFor, canFilterBranch, canFilterRm, accessLabel, type DataAccess } from "@/lib/dashboards/system/access";
import {
  SYSTEM_WIDGETS, SYSTEM_WIDGETS_BY_KEY, MAX_WIDGETS, sanitizeLayoutItems, duplicateWidgets, migrateLegacyLayout,
} from "@/lib/dashboards/system/catalog";
import { SYSTEM_DASHBOARDS, ROLE_DEFAULTS } from "@/lib/dashboards/system/definitions";
import { effectiveSizes } from "@/components/dashboards/system/sizes";
import { canEdit, canShare, canShareOrDelete, canView, shareReaches, type ShareRow, type ViewerFacts } from "@/lib/dashboards/platform";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Dashboard } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";

const TODAY = "2026-09-29"; // a Tuesday

const session = (roles: string[], extra: Partial<SessionUser> = {}): SessionUser =>
  ({ userId: "u-1", tenantId: "t-1", roles, email: "x@y.z", permissions: [], ...extra }) as SessionUser;

const board = (over: Partial<Dashboard> = {}): Dashboard =>
  ({
    id: "d-1", tenantId: "t-1", userId: "owner-2", name: "Board", description: null, scope: "private",
    isDefault: false, locked: false, layout: [], filters: null, deletedAt: null, createdBy: "owner-2",
    isSystem: false, systemKey: null, filterConfig: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  }) as Dashboard;

describe("Period — India dates, same period last year", () => {
  it("resolves This FY with its range as the label", () => {
    const p = resolvePeriod("fy", { today: TODAY });
    expect([p.from, p.to]).toEqual(["2026-04-01", "2026-09-29"]);
    expect(p.label).toBe("This FY (1 Apr – 29 Sep 2026)");
    expect(p.prev).toEqual({ from: "2025-04-01", to: "2025-09-29" });
    expect(p.fiscalYear).toBe("2026-27");
  });

  it("resolves every other period", () => {
    const r = (k: string) => { const p = resolvePeriod(k, { today: TODAY }); return [p.from, p.to]; };
    expect(r("today")).toEqual([TODAY, TODAY]);
    expect(r("week")).toEqual(["2026-09-28", TODAY]); // Monday start
    expect(r("month")).toEqual(["2026-09-01", TODAY]);
    expect(r("last_month")).toEqual(["2026-08-01", "2026-08-31"]);
    expect(r("quarter")).toEqual(["2026-07-01", TODAY]); // FY Q2 = Jul–Sep
    expect(r("last_fy")).toEqual(["2025-04-01", "2026-03-31"]);
  });

  it("handles a custom range, a bad one, and year boundaries", () => {
    expect(resolvePeriod("custom", { today: TODAY, from: "2026-05-03", to: "2026-06-10" }).label).toBe("3 May – 10 Jun 2026");
    expect(resolvePeriod("custom", { today: TODAY, from: "nope" }).key).toBe("fy");
    // Picked backwards it is still the range meant; it stops at today; one that
    // has not started yet falls back rather than counting nothing.
    const back = resolvePeriod("custom", { today: TODAY, from: "2032-09-01", to: "2026-09-21" });
    expect([back.from, back.to]).toEqual(["2026-09-21", TODAY]);
    expect(resolvePeriod("custom", { today: TODAY, from: "2026-09-01", to: "2026-12-31" }).to).toBe(TODAY);
    expect(resolvePeriod("custom", { today: TODAY, from: "2027-01-01", to: "2027-02-01", fallback: "month" }).key).toBe("month");
    expect(resolvePeriod("junk", { today: TODAY, fallback: "month" }).key).toBe("month");
    expect(resolvePeriod("quarter", { today: "2027-02-10" }).from).toBe("2027-01-01"); // Q4 = Jan–Mar
    expect(fyStartOf("2027-02-10")).toBe("2026-04-01");
    expect(fiscalYearKey("2099-04-01")).toBe("2099-00");
    expect(minusYear("2028-02-29")).toBe("2027-02-28");
    expect(formatRange("2025-12-20", "2026-01-05")).toBe("20 Dec 2025 – 5 Jan 2026");
  });

  it("tracks how far through the FY the period ends", () => {
    expect(resolvePeriod("last_fy", { today: TODAY }).fyPace).toBe(1);
    const pace = resolvePeriod("fy", { today: TODAY }).fyPace;
    expect(pace).toBeGreaterThan(0.49);
    expect(pace).toBeLessThan(0.51);
  });
});

describe("Filters — the URL is the state", () => {
  it("round-trips through query params", () => {
    const state = { period: "month" as const, values: { rm: ["me", "u-2"], segment: ["HNI"], leadSource: ["referral"] } };
    const qs = filterStateToParams(state);
    expect(qs.toString()).toBe("period=month&rm=me%2Cu-2&seg=HNI&src=referral");
    const back = parseFilterState(Object.fromEntries(qs.entries()));
    expect(back).toEqual({ period: "month", from: undefined, to: undefined, values: state.values });
    expect(activeFilterKeys(back)).toEqual(["rm", "segment", "leadSource"]);
  });

  it("uses a saved filter only when the URL sets nothing", () => {
    expect(hasFilterParams({})).toBe(false);
    expect(hasFilterParams({ period: "fy" })).toBe(true);
    expect(hasFilterParams({ branch: "b-1" })).toBe(true);
    const saved = { period: "last_month" as const, values: { category: ["A"] } };
    expect(parseFilterState({}, saved).values).toEqual({ category: ["A"] });
    // An explicit empty param clears the saved value.
    expect(parseFilterState({ cat: "" }, saved).values).toEqual({});
  });

  it("keeps only known filters from anything stored or posted", () => {
    const s = sanitizeFilterState({ period: "nonsense", values: { rm: ["a"], evil: ["x"], tags: "notalist" } });
    expect(s).toEqual({ period: "fy", from: undefined, to: undefined, values: { rm: ["a"] } });
    expect(sanitizeFilterState(null)).toBeNull();
  });
});

describe("Data access — a shared dashboard never widens what it counts", () => {
  it("gives the owner the firm, a branch head their branch, an RM their book", () => {
    expect(dataAccessFor(session(["owner"]))).toEqual({ kind: "firm" });
    expect(dataAccessFor(session(["branch_head"], { branchId: "b-1" }))).toEqual({ kind: "branch", branchId: "b-1" });
    expect(dataAccessFor(session(["branch_head"]))).toEqual({ kind: "self", userId: "u-1" });
    expect(dataAccessFor(session(["rm"]))).toEqual({ kind: "self", userId: "u-1" });
    expect(dataAccessFor(session(["compliance"]))).toEqual({ kind: "firm" });
  });

  it("lets filters narrow inside the access, never outside it", () => {
    const state = { period: "fy" as const, values: { rm: ["someone-else"], branch: ["b-9"] } };
    expect(scopeFor("t-1", session(["rm"]), { kind: "self", userId: "u-1" }, state).rmIds).toEqual(["u-1"]);
    const bh = scopeFor("t-1", session(["branch_head"], { branchId: "b-1" }), { kind: "branch", branchId: "b-1" }, state);
    expect(bh.branchIds).toEqual(["b-1"]);
    const me = scopeFor("t-1", session(["owner"]), { kind: "firm" }, { period: "fy", values: { rm: ["me"] } });
    expect(me.rmIds).toEqual(["u-1"]);
    expect(canFilterRm({ kind: "self", userId: "u-1" })).toBe(false);
    expect(canFilterBranch({ kind: "firm" }, 1)).toBe(false);
    expect(canFilterBranch({ kind: "firm" }, 2)).toBe(true);
    expect(canFilterBranch({ kind: "branch", branchId: "b-1" }, 5)).toBe(false);
  });

  it("gives someone people report to their team, and never anyone else", () => {
    const team: DataAccess = { kind: "team", userId: "u-1", memberIds: ["u-1", "u-2", "u-3"] };
    const s = session(["rm"]);
    // No RM picked: the whole team. One picked: that one. Someone outside: the team, never them.
    expect(scopeFor("t-1", s, team, { period: "fy", values: {} }).rmIds).toEqual(["u-1", "u-2", "u-3"]);
    expect(scopeFor("t-1", s, team, { period: "fy", values: { rm: ["u-2"] } }).rmIds).toEqual(["u-2"]);
    expect(scopeFor("t-1", s, team, { period: "fy", values: { rm: ["me"] } }).rmIds).toEqual(["u-1"]);
    expect(scopeFor("t-1", s, team, { period: "fy", values: { rm: ["peer-9"] } }).rmIds).toEqual(["u-1", "u-2", "u-3"]);
    expect(scopeFor("t-1", s, team, { period: "fy", values: { branch: ["b-9"] } }).branchIds).toBeUndefined();
    expect(canFilterRm(team)).toBe(true);
    expect(canFilterBranch(team, 3)).toBe(false);
    expect(accessLabel(team)).toBe("you and your team (2 people)");
  });
});

describe("Sharing and locking", () => {
  const rm: ViewerFacts = { session: session(["rm"]), deskId: "desk-1" };
  const ownerViewer: ViewerFacts = { session: session(["owner"], { userId: "boss" }), deskId: null };
  const roleShare: ShareRow[] = [{ shareType: "role", shareRef: "rm", includeSubordinates: false }];

  it("reaches users, roles (with subordinates), branches and teams", () => {
    expect(shareReaches(rm, { shareType: "all", shareRef: "", includeSubordinates: false })).toBe(true);
    expect(shareReaches(rm, { shareType: "role", shareRef: "rm", includeSubordinates: false })).toBe(true);
    expect(shareReaches(rm, { shareType: "role", shareRef: "branch_head", includeSubordinates: false })).toBe(false);
    expect(shareReaches(rm, { shareType: "role", shareRef: "branch_head", includeSubordinates: true })).toBe(true);
    expect(shareReaches(rm, { shareType: "team", shareRef: "desk-1", includeSubordinates: false })).toBe(true);
    expect(shareReaches(rm, { shareType: "user", shareRef: "someone", includeSubordinates: false })).toBe(false);
  });

  it("a locked dashboard shared with RMs can be seen and cloned but not edited", () => {
    const d = board({ locked: true });
    expect(canView(rm, d, roleShare)).toBe(true);
    expect(canEdit(rm, d, roleShare)).toBe(false);
    expect(canShareOrDelete(rm, d)).toBe(false);
    // Unlocked, the same share lets them edit; the owner can always edit.
    expect(canEdit(rm, board(), roleShare)).toBe(true);
    expect(canEdit(ownerViewer, d, roleShare)).toBe(true);
  });

  it("keeps a private dashboard private, and system dashboards locked for everyone", () => {
    expect(canView(rm, board(), [])).toBe(false);
    expect(canView(ownerViewer, board(), [])).toBe(true); // "Other users' dashboards"
    const sys = board({ isSystem: true, systemKey: "owner", userId: null, locked: true });
    const byRole: ShareRow[] = [{ shareType: "all", shareRef: "", includeSubordinates: false }];
    expect(canView(rm, sys, byRole)).toBe(false);
    expect(canView({ session: session(["compliance"]), deskId: null }, sys, byRole)).toBe(true);
    expect(canEdit(ownerViewer, sys, [])).toBe(false);
    expect(canShareOrDelete(ownerViewer, sys)).toBe(false);
  });

  it("shares a role dashboard with particular people, or limits it to them", () => {
    const all: ShareRow = { shareType: "all", shareRef: "", includeSubordinates: false };
    const pooja: ShareRow = { shareType: "user", shareRef: "u-1", includeSubordinates: false };
    const owner = board({ isSystem: true, systemKey: "owner", userId: null, locked: true });
    const compliance: ViewerFacts = { session: session(["compliance"], { userId: "c-1" }), deskId: null };
    // Default: the roles it is for (compliance), not an RM.
    expect(canView(compliance, owner, [all])).toBe(true);
    expect(canView(rm, owner, [all])).toBe(false);
    // Shared with that RM by name: they see it too.
    expect(canView(rm, owner, [all, pooja])).toBe(true);
    // Limited to them: the role audience no longer sees it; an admin always does.
    expect(canView(compliance, owner, [pooja])).toBe(false);
    expect(canView(rm, owner, [pooja])).toBe(true);
    expect(canView(ownerViewer, owner, [])).toBe(true);
    // A role dashboard is shared by an admin only, and never deleted.
    expect(canShare(ownerViewer, owner)).toBe(true);
    expect(canShare(rm, owner)).toBe(false);
    expect(canShareOrDelete(ownerViewer, owner)).toBe(false);
  });

  it("never shows a system row this build does not define (a retired key)", () => {
    const retired = board({ isSystem: true, systemKey: "leads_sales", userId: null, locked: true });
    expect(canView(ownerViewer, retired, [])).toBe(false);
  });
});

describe("System dashboards and the widget library", () => {
  it("are the six role dashboards, Owner first", () => {
    expect(SYSTEM_DASHBOARDS.map((d) => d.name)).toEqual([
      "Owner Dashboard", "Branch Head Dashboard", "Relationship Manager Dashboard",
      "Operations Dashboard", "Insurance Team Dashboard", "Claims Dashboard",
    ]);
  });

  it("make the Owner Dashboard of cards and the other five full role pages", () => {
    const byKey = Object.fromEntries(SYSTEM_DASHBOARDS.map((d) => [d.key, d]));
    expect(byKey.owner.centre).toBeUndefined();
    expect(byKey.owner.layout.length).toBeGreaterThan(10);
    expect(byKey.owner.layout.length).toBeLessThanOrEqual(MAX_WIDGETS);
    expect(Object.fromEntries(SYSTEM_DASHBOARDS.filter((d) => d.centre).map((d) => [d.key, d.centre]))).toEqual({
      branch_head: "branch", rm: "rm", operations: "ops", insurance: "insurance", claims: "claims",
    });
    for (const d of SYSTEM_DASHBOARDS) if (d.centre) expect(d.layout, d.key).toEqual([]);
  });

  it("put the KPI row first on the Owner Dashboard, and leads and compliance on it too", () => {
    const owner = SYSTEM_DASHBOARDS.find((d) => d.key === "owner")!;
    expect(owner.layout[0].widgetKey).toBe("kpi_row");
    const keys = owner.layout.map((i) => i.widgetKey);
    for (const k of ["needs_attention", "lead_pipeline", "team_table", "compliance_gaps", "expiry_pipeline"]) expect(keys, k).toContain(k);
    // Headline, then today's actions, then the team, then the analysis.
    expect(keys.indexOf("needs_attention")).toBeLessThan(keys.indexOf("team_table"));
    expect(keys.indexOf("team_table")).toBeLessThan(keys.indexOf("business_trend"));
  });

  it("show each role its own dashboard", () => {
    const visible = (s: SessionUser) => SYSTEM_DASHBOARDS.filter((d) => d.visibleTo(s)).map((d) => d.key);
    expect(visible(session(["owner"]))).toEqual(["owner", "branch_head", "rm", "operations", "insurance", "claims"]);
    expect(visible(session(["rm"]))).toEqual(["rm"]);
    expect(visible(session(["ops"]))).toEqual(["operations"]);
    expect(visible(session(["insurance_team"]))).toEqual(["rm", "insurance", "claims"]);
    // A branch head locked to their branch never gets the firm's Owner Dashboard.
    expect(visible(session(["branch_head"], { branchId: "b-1" }))).toEqual(["branch_head", "rm"]);
    expect(visible(session(["compliance"]))).toEqual(["owner"]);
  });

  it("only place widgets that exist, and every widget has an implementation", () => {
    for (const d of SYSTEM_DASHBOARDS) for (const i of d.layout) expect(SYSTEM_WIDGETS_BY_KEY[i.widgetKey], `${d.key}/${i.widgetKey}`).toBeTruthy();
    // The implementations are .tsx server components; read their keys as text
    // (the test runner does not compile JSX) — each is `{ key: "…", render: … }`.
    const dir = join(process.cwd(), "src/components/dashboards/system/widgets");
    const implemented = new Set<string>();
    for (const f of readdirSync(dir)) {
      for (const m of readFileSync(join(dir, f), "utf8").matchAll(/key: "([a-z_]+)",\s*render:/g)) implemented.add(m[1]);
    }
    for (const w of SYSTEM_WIDGETS) expect(implemented.has(w.key), w.key).toBe(true);
  });

  it("seed each role's default to its own dashboard", () => {
    const def = Object.fromEntries(ROLE_DEFAULTS.map((r) => [r.role, r.dashboard]));
    expect(def).toEqual({
      owner: "owner", branch_head: "branch_head", rm: "rm", team_member: "rm",
      ops: "operations", back_office: "operations", service_team: "operations",
      compliance: "owner", marketing: "owner", insurance_team: "insurance",
    });
    // Every default is a dashboard that role can see.
    for (const r of ROLE_DEFAULTS) {
      const d = SYSTEM_DASHBOARDS.find((x) => x.key === r.dashboard)!;
      expect(d.visibleTo(session([r.role], { branchId: "b-1" })), `${r.role} → ${r.dashboard}`).toBe(true);
    }
  });

  it("cap a layout at 16 widgets, drop unknown ones, and warn on duplicates", () => {
    const many = Array.from({ length: 20 }, (_, n) => ({ id: `w${n}`, widgetKey: n % 2 ? "kpi_row" : "nope", size: "L" }));
    const clean = sanitizeLayoutItems(many);
    expect(clean.length).toBe(10); // 10 known of 20, under the cap
    expect(sanitizeLayoutItems(Array.from({ length: 20 }, (_, n) => ({ id: `k${n}`, widgetKey: "lead_pipeline", size: "M" }))).length).toBe(MAX_WIDGETS);
    expect(duplicateWidgets(clean)).toEqual(["kpi_row"]);
    expect(sanitizeLayoutItems([{ widgetKey: "team_table", size: "S" }])[0].size).toBe("L"); // S not allowed
  });

  it("open an old custom board with the equivalent metric widgets", () => {
    const old = [{ widgetKey: "kpi_aum" }, { widgetKey: "kpi_active_sip" }, { widgetKey: "table_rm_business" }, { widgetKey: "chart_scheme_category" }];
    expect(migrateLegacyLayout(old).map((i) => i.widgetKey)).toEqual(["kpi_row", "team_table"]);
  });

  it("give a half-width card whose partner hid itself the whole row", () => {
    expect(effectiveSizes(["L", "M", "M", "L"])).toEqual(["L", "M", "M", "L"]);
    expect(effectiveSizes(["L", "M", "L", "M", "M"])).toEqual(["L", "L", "L", "M", "M"]);
    expect(effectiveSizes(["M", "M", "M"])).toEqual(["M", "M", "L"]);
    expect(effectiveSizes(["S", "M"])).toEqual(["S", "L"]);
  });
});
