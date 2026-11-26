/**
 * Visitor Register (Akshar Invest, 2026-11-26): its field rules, and that a
 * firm without the switch cannot see or call any of it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  flags: {} as Record<string, unknown>,
  roles: ["owner"] as string[],
  permissions: null as string[] | null,
  transactions: 0,
}));

vi.mock("@/lib/auth/session", () => {
  const session = async () => ({
    userId: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    roles: state.roles,
    permissions: state.permissions,
    email: "x@t.in",
    name: "X",
  });
  return { requireSession: session, requirePageSession: session };
});
vi.mock("@/lib/auth/license", () => ({
  loadTenantLicense: async () => ({ featureFlags: state.flags }),
  assertActiveLicense: async () => {},
}));
// The database is never reached by a refused request; this counts any that is.
vi.mock("@/db/client", () => ({
  withTenant: async () => {
    state.transactions++;
    return { rows: [], total: 0, page: 1, totalPages: 1, hasAny: false };
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { NextRequest } from "next/server";
import { FEATURE_FLAGS, sanitizeFeatureFlagOverride } from "@/config/feature-flags";
import { ALL_NAV_ITEMS, gatedNavKeyForPath } from "@/config/nav-access";
import { VISITOR_REGISTER_FLAG } from "@/lib/visitors/access";
import {
  VISITOR_LABELS, VisitorCreateBody, VisitorPatchBody, exitBeforeEntry, formatVisitTime, parseVisitorFilter,
} from "@/lib/visitors/entry";
import { requireVisitorPage } from "@/lib/visitors/page";
import * as collection from "@/app/api/visitors/route";
import * as item from "@/app/api/visitors/[id]/route";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

beforeEach(() => {
  state.flags = {};
  state.roles = ["owner"];
  state.permissions = null;
  state.transactions = 0;
});

describe("the fields", () => {
  it("are the ten asked for, labelled as asked", () => {
    expect(Object.values(VISITOR_LABELS)).toEqual([
      "Visitor Name", "Email", "Mobile Number", "Company Name", "Visit Date",
      "Entry Time", "Exit Time", "Purpose of Visit", "Meeting with", "Remarks",
    ]);
  });

  it("need only a name and a visit date; blanks are stored as nothing", () => {
    const parsed = VisitorCreateBody.parse({
      visitorName: "  Meera   Shah ", visitDate: "2026-11-26", email: "", mobile: " ", companyName: "",
      entryTime: "", exitTime: "", purpose: "  ", meetingWithUserId: "", remarks: "",
    });
    expect(parsed).toEqual({
      visitorName: "Meera Shah", visitDate: "2026-11-26", email: null, mobile: null, companyName: null,
      entryTime: null, exitTime: null, purpose: null, meetingWithUserId: null, remarks: null,
    });
    expect(VisitorCreateBody.safeParse({ visitDate: "2026-11-26" }).success).toBe(false);
    expect(VisitorCreateBody.safeParse({ visitorName: "A" }).success).toBe(false);
    expect(VisitorCreateBody.safeParse({ visitorName: "   ", visitDate: "2026-11-26" }).success).toBe(false);
  });

  it("keep line breaks only in the multi-line fields", () => {
    const parsed = VisitorCreateBody.parse({
      visitorName: "A\nB", companyName: "C\r\nD", visitDate: "2026-11-26", purpose: "one\r\ntwo", remarks: "three\nfour",
    });
    expect(parsed.visitorName).toBe("A B");
    expect(parsed.companyName).toBe("C D");
    expect(parsed.purpose).toBe("one\ntwo");
    expect(parsed.remarks).toBe("three\nfour");
  });

  it.each([
    ["email", "not-an-email"],
    ["mobile", "abc"],
    ["mobile", "12345"],
    ["mobile", "98765x43210"],
    ["visitDate", "26/11/2026"],
    ["visitDate", "2026-02-30"],
    ["entryTime", "25:00"],
    ["exitTime", "9.30"],
    ["meetingWithUserId", "Ramesh"],
    ["purpose", "x".repeat(2001)],
  ])("refuse a bad %s (%s)", (field, value) => {
    const r = VisitorCreateBody.safeParse({ visitorName: "A", visitDate: "2026-11-26", [field]: value });
    expect(r.success).toBe(false);
    expect(r.success ? "" : r.error.issues[0].path[0]).toBe(field);
  });

  it("accept an Indian mobile however it is written, and a database time", () => {
    for (const mobile of ["9876543210", "+91 98765 43210", "(079) 2646-1234"]) {
      expect(VisitorCreateBody.safeParse({ visitorName: "A", visitDate: "2026-11-26", mobile }).success).toBe(true);
    }
    expect(VisitorCreateBody.parse({ visitorName: "A", visitDate: "2026-11-26", entryTime: "10:30:00" }).entryTime).toBe("10:30");
  });

  it("an edit changes only what it sends", () => {
    expect(VisitorPatchBody.parse({ exitTime: "12:00" })).toEqual({ exitTime: "12:00" });
    expect(VisitorPatchBody.parse({ email: "" })).toEqual({ email: null });
    expect(VisitorPatchBody.safeParse({ visitorName: "" }).success).toBe(false);
    expect(VisitorPatchBody.safeParse({ visitDate: null }).success).toBe(false);
  });

  it("an exit cannot be before the entry; a missing time is not an error", () => {
    expect(exitBeforeEntry("10:00", "09:59")).toBe(true);
    expect(exitBeforeEntry("10:00", "10:00")).toBe(false);
    expect(exitBeforeEntry("10:00", null)).toBe(false);
    expect(exitBeforeEntry(null, "09:00")).toBe(false);
  });

  it("show times on a 12-hour clock", () => {
    expect(formatVisitTime("00:05")).toBe("12:05 AM");
    expect(formatVisitTime("12:00:00")).toBe("12:00 PM");
    expect(formatVisitTime("17:21")).toBe("5:21 PM");
    expect(formatVisitTime(null)).toBe("—");
  });

  it("read the search and date filter from the URL", () => {
    expect(parseVisitorFilter({ q: " shah ", from: "2026-11-30", to: "2026-11-01", page: "3" }))
      .toEqual({ q: "shah", from: "2026-11-01", to: "2026-11-30", page: 3 });
    expect(parseVisitorFilter({ from: "yesterday", page: "-2" })).toEqual({ q: "", from: "", to: "", page: 1 });
  });
});

describe("the per-firm switch", () => {
  const url = "http://test/api/visitors";
  const body = JSON.stringify({ visitorName: "A", visitDate: "2026-11-26" });
  const ctx = { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) };
  const calls: [string, () => Promise<Response>][] = [
    ["list", () => collection.GET(new NextRequest(url))],
    ["add", () => collection.POST(new NextRequest(url, { method: "POST", body }))],
    ["view", () => item.GET(new NextRequest(url), ctx)],
    ["edit", () => item.PATCH(new NextRequest(url, { method: "PATCH", body }), ctx)],
    ["delete", () => item.DELETE(new NextRequest(url, { method: "DELETE" }), ctx)],
  ];

  it("is a flag a super admin can set for one firm", () => {
    expect(FEATURE_FLAGS.some((f) => f.key === VISITOR_REGISTER_FLAG && f.type === "boolean")).toBe(true);
    expect(sanitizeFeatureFlagOverride({ [VISITOR_REGISTER_FLAG]: true })).toEqual({ [VISITOR_REGISTER_FLAG]: true });
  });

  it.each(calls)("off: %s is not found, even for the owner, and nothing is read", async (_name, call) => {
    for (const flags of [{}, { [VISITOR_REGISTER_FLAG]: false }, { [VISITOR_REGISTER_FLAG]: "true" }]) {
      state.flags = flags;
      const res = await call();
      expect(res.status).toBe(404);
    }
    expect(state.transactions).toBe(0);
  });

  it("off: a page is not found", async () => {
    await expect(requireVisitorPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("on: a page opens", async () => {
    state.flags = { [VISITOR_REGISTER_FLAG]: true };
    await expect(requireVisitorPage()).resolves.toMatchObject({ canEdit: true });
  });

  it("every page runs the gate itself", () => {
    const dir = "src/app/dashboard/visitors";
    const pages = (readdirSync(join(root, dir), { recursive: true }) as string[]).filter((f) => f.endsWith("page.tsx"));
    expect(pages).toHaveLength(4);
    for (const page of pages) expect(read(`${dir}/${page}`)).toContain("await requireVisitorPage()");
  });

  it("the menu item is drawn only with the flag", () => {
    expect(read("src/app/dashboard/layout.tsx")).toMatch(
      /href: "\/dashboard\/visitors",[^}]*flag: "visitorRegister"/,
    );
  });

  it("no saved sidebar list can hide it: it is not a grant of its own", () => {
    expect(ALL_NAV_ITEMS.some((i) => i.key.startsWith("/dashboard/visitors"))).toBe(false);
    expect(gatedNavKeyForPath("/dashboard/visitors/new")).toBeNull();
  });

  describe("on", () => {
    beforeEach(() => {
      state.flags = { [VISITOR_REGISTER_FLAG]: true };
    });

    it.each(["rm", "team_member", "back_office", "branch_head", "service_team", "compliance"])("a %s can record a visit", async (role) => {
      state.roles = [role];
      expect((await calls[1][1]()).status).toBe(201);
    });

    it("a Viewer reads but cannot add, edit or delete", async () => {
      state.roles = ["viewer"];
      expect((await calls[0][1]()).status).toBe(200);
      for (const i of [1, 3, 4]) expect((await calls[i][1]()).status).toBe(403);
      await expect(requireVisitorPage()).resolves.toMatchObject({ canEdit: false });
    });

    it("a customised permission list without task editing cannot write", async () => {
      state.roles = ["rm"];
      state.permissions = ["investor.view.assigned"];
      expect((await calls[1][1]()).status).toBe(403);
      expect((await calls[0][1]()).status).toBe(200);
    });

    it("an invalid visit is refused before the database", async () => {
      const res = await collection.POST(new NextRequest(url, { method: "POST", body: JSON.stringify({ visitorName: "" }) }));
      expect(res.status).toBe(400);
      expect(state.transactions).toBe(0);
    });
  });
});

describe("migration 0293", () => {
  const sqlText = read("drizzle/migrations/0293_visitor_register.sql");
  it("forces row-level security with the tenant_isolation policy", () => {
    expect(sqlText).toContain("ALTER TABLE visitor_entries ENABLE ROW LEVEL SECURITY");
    expect(sqlText).toContain("ALTER TABLE visitor_entries FORCE ROW LEVEL SECURITY");
    expect(sqlText).toContain("CREATE POLICY tenant_isolation ON visitor_entries");
  });

  it("switches the register on for ARN 110756 only, under the platform-admin context the RLS needs", () => {
    expect(sqlText).toContain(`'{"${VISITOR_REGISTER_FLAG}": true}'::jsonb`);
    expect(sqlText).toContain("regexp_replace(t.arn, '[^0-9]', '', 'g') = '110756'");
    expect(sqlText).toContain("app.is_platform_admin");
    expect(sqlText.match(/UPDATE subscriptions/g)).toHaveLength(1);
  });
});
