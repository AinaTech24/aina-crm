/**
 * Couriers (Akshar Invest, 2026-11-27): the field rules, and that a firm without
 * the switch cannot see or call any of it.
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
import { COURIER_FLAG } from "@/lib/couriers/access";
import {
  COURIER_CATEGORIES, COURIER_LABELS, COURIER_STATUSES, CourierBody, CourierPatchBody, categoryText, formatCharges,
  isCourierFiltered, parseCourierFilter,
} from "@/lib/couriers/entry";
import { requireCourierPage } from "@/lib/couriers/page";
import * as collection from "@/app/api/couriers/route";
import * as item from "@/app/api/couriers/[id]/route";
import * as importing from "@/app/api/couriers/import/route";
import * as sample from "@/app/api/couriers/import/sample/route";
import * as exportList from "@/app/api/export/route";
import * as exportModule from "@/app/api/export/[module]/route";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

beforeEach(() => {
  state.flags = {};
  state.roles = ["owner"];
  state.permissions = null;
  state.transactions = 0;
});

const inward = { courierType: "inward", courierDate: "2026-11-27", status: "received" };
const outward = { courierType: "outward", courierDate: "2026-11-27", status: "pending" };
const refusedField = (input: Record<string, unknown>) => {
  const r = CourierBody.safeParse(input);
  return r.success ? "" : r.error.issues[0].path[0];
};

describe("the fields", () => {
  it("are the ones asked for, labelled as asked", () => {
    expect(Object.values(COURIER_LABELS)).toEqual([
      "Courier Type", "Courier Company", "Tracking Number", "Courier Date", "Courier Status", "Courier Category",
      "Other Category", "Courier Description", "Remarks",
      "Sender Name", "Sender Company", "Sender Mobile", "Sender Email", "Sender Address", "Received Date",
      "Recipient Name", "Recipient Company", "Recipient Mobile", "Recipient Email", "Recipient Address",
      "Dispatch Date", "Courier Charges", "Payment Mode", "Delivered Date",
    ]);
    expect(COURIER_CATEGORIES.map((c) => c.label)).toEqual(
      ["Documents", "Parcel", "Cheque", "Agreement", "KYC Documents", "Office Supplies", "Other"],
    );
    expect(COURIER_STATUSES.inward.map((s) => s.label)).toEqual(["In Transit", "Received", "Handed Over", "Returned"]);
    expect(COURIER_STATUSES.outward.map((s) => s.label)).toEqual(["Pending", "Dispatched", "In Transit", "Delivered", "Returned", "Lost"]);
  });

  it("need only a type, a date and a status; blanks are stored as nothing", () => {
    const parsed = CourierBody.parse({ ...inward, courierCompany: "  Blue   Dart ", trackingNumber: "", senderName: " ", category: "" });
    expect(parsed).toMatchObject({ courierCompany: "Blue Dart", trackingNumber: null, senderName: null, category: null, receivedDate: null });
    expect(Object.keys(parsed)).toHaveLength(Object.keys(COURIER_LABELS).length);
    expect(refusedField({ courierDate: "2026-11-27", status: "received" })).toBe("courierType");
    expect(refusedField({ courierType: "inward", status: "received" })).toBe("courierDate");
    expect(refusedField({ courierType: "inward", courierDate: "2026-11-27" })).toBe("status");
  });

  it("offer each type only its own statuses", () => {
    expect(refusedField({ ...inward, status: "delivered" })).toBe("status");
    expect(refusedField({ ...outward, status: "received" })).toBe("status");
    expect(refusedField({ ...outward, status: "lost" })).toBe("");
    expect(refusedField({ ...inward, status: "handed_over" })).toBe("");
  });

  it("ask for the category's name when it is Other, and drop it otherwise", () => {
    expect(refusedField({ ...inward, category: "other" })).toBe("categoryOther");
    expect(CourierBody.parse({ ...inward, category: "other", categoryOther: " Gift  hamper " }).categoryOther).toBe("Gift hamper");
    expect(CourierBody.parse({ ...inward, category: "cheque", categoryOther: "left over" }).categoryOther).toBeNull();
    expect(categoryText("other", "Gift hamper")).toBe("Other — Gift hamper");
    expect(categoryText("kyc_documents", null)).toBe("KYC Documents");
    expect(categoryText(null, null)).toBeNull();
  });

  it("keep only the details of the courier's own type, even bad ones left over from the other", () => {
    const parsed = CourierBody.parse({ ...inward, senderName: "S", recipientName: "R", recipientEmail: "not-an-email", courierCharges: "abc" });
    expect(parsed).toMatchObject({ senderName: "S", recipientName: null, recipientEmail: null, courierCharges: null });
    const sent = CourierBody.parse({ ...outward, senderName: "S", receivedDate: "2026-11-27", recipientName: "R" });
    expect(sent).toMatchObject({ senderName: null, receivedDate: null, recipientName: "R" });
  });

  it.each([
    [inward, "senderEmail", "not-an-email"],
    [inward, "senderMobile", "12345"],
    [inward, "receivedDate", "2026-02-30"],
    [inward, "category", "furniture"],
    [outward, "recipientMobile", "98765x43210"],
    [outward, "courierCharges", "-5"],
    [outward, "courierCharges", "12.345"],
    [outward, "paymentMode", "barter"],
    [outward, "dispatchDate", "27/11/2026"],
    [inward, "description", "x".repeat(2001)],
  ])("refuse a bad value (%#)", (base, field, value) => {
    expect(refusedField({ ...base, [field]: value })).toBe(field);
  });

  it("read charges however they are written", () => {
    expect(CourierBody.parse({ ...outward, courierCharges: "₹ 1,250.50" }).courierCharges).toBe("1250.50");
    expect(CourierBody.parse({ ...outward, courierCharges: 90 }).courierCharges).toBe("90");
    expect(formatCharges("1250.50")).toBe("₹1,250.5");
    expect(formatCharges(null)).toBe("—");
  });

  it("refuse a delivery before the dispatch", () => {
    expect(refusedField({ ...outward, dispatchDate: "2026-11-27", deliveredDate: "2026-11-26" })).toBe("deliveredDate");
    expect(refusedField({ ...outward, dispatchDate: "2026-11-27", deliveredDate: "2026-11-27" })).toBe("");
    expect(refusedField({ ...outward, deliveredDate: "2026-11-26" })).toBe("");
  });

  it("an edit passes on only what it sends", () => {
    expect(CourierPatchBody.parse({ status: "delivered", junk: 1 })).toEqual({ status: "delivered" });
    expect(CourierPatchBody.parse({ remarks: null })).toEqual({ remarks: null });
    expect(CourierPatchBody.safeParse({ remarks: ["a"] }).success).toBe(false);
  });

  it("read the search and the filters from the URL", () => {
    expect(parseCourierFilter({
      q: " dart ", type: "outward", status: "pending,lost", category: "cheque", courier_from: "2026-11-30",
      courier_to: "2026-11-01", company: " Blue ", page: "3",
    })).toEqual({
      q: "dart", type: "outward", statuses: ["pending", "lost"], categories: ["cheque"], from: "2026-11-01",
      to: "2026-11-30", company: "Blue", page: 3,
    });
    // Anything that is not a choice or a date is ignored, never sent to the database.
    const junk = parseCourierFilter({ type: "sideways", status: "x,' OR 1=1", category: "y", courier_from: "yesterday", page: "-2" });
    expect(junk).toEqual({ q: "", type: "", statuses: [], categories: [], from: "", to: "", company: "", page: 1 });
    expect(isCourierFiltered(junk)).toBe(false);
    expect(isCourierFiltered(parseCourierFilter({ type: "inward" }))).toBe(true);
    expect(isCourierFiltered(parseCourierFilter({ page: "4" }))).toBe(false);
  });

  it("offers the filters behind the Filters button, under the names the URL is read by", () => {
    const page = read("src/app/dashboard/couriers/page.tsx");
    expect(page).toContain("<CompactFilterBar");
    for (const f of ['key: "type"', 'key: "status"', 'key: "category"', 'type: "date_range", key: "courier"', 'key: "company"']) {
      expect(page).toContain(f);
    }
    expect(page).toContain('<ExportButton module="couriers" />');
  });
});

describe("the per-firm switch", () => {
  const url = "http://test/api/couriers";
  const body = JSON.stringify(inward);
  const ctx = { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) };
  const exportCtx = { params: Promise.resolve({ module: "couriers" }) };
  const sampleCall = (query: string) => sample.GET(new NextRequest(`${url}/import/sample${query}`));
  const calls: [string, () => Promise<Response>][] = [
    ["list", () => collection.GET(new NextRequest(url))],
    ["add", () => collection.POST(new NextRequest(url, { method: "POST", body }))],
    ["view", () => item.GET(new NextRequest(url), ctx)],
    ["edit", () => item.PATCH(new NextRequest(url, { method: "PATCH", body }), ctx)],
    ["delete", () => item.DELETE(new NextRequest(url, { method: "DELETE" }), ctx)],
    ["import", () => importing.POST(new Request(`${url}/import?mode=import`, { method: "POST" }))],
    ["Excel sample", () => sampleCall("")],
    ["CSV sample", () => sampleCall("?format=csv")],
    ["export fields", () => exportModule.GET(new NextRequest("http://test/api/export/couriers"), exportCtx)],
    ["export file", () => exportModule.POST(new NextRequest("http://test/api/export/couriers", { method: "POST", body: JSON.stringify({ fields: ["courierType"] }) }), exportCtx)],
  ];
  const exportable = async () => ((await (await exportList.GET()).json()) as { modules: string[] }).modules;

  it("is a flag a super admin can set for one firm", () => {
    expect(FEATURE_FLAGS.some((f) => f.key === COURIER_FLAG && f.type === "boolean")).toBe(true);
    expect(sanitizeFeatureFlagOverride({ [COURIER_FLAG]: true })).toEqual({ [COURIER_FLAG]: true });
  });

  it.each(calls)("off: %s is not found, even for the owner, and nothing is read", async (_name, call) => {
    // The Visitor Register's switch does not switch Couriers on.
    for (const flags of [{}, { [COURIER_FLAG]: false }, { [COURIER_FLAG]: "true" }, { visitorRegister: true }]) {
      state.flags = flags;
      const res = await call();
      expect(res.status).toBe(404);
    }
    expect(state.transactions).toBe(0);
  });

  it("off: Export is not offered, though the owner exports other lists", async () => {
    const modules = await exportable();
    expect(modules).toContain("leads");
    expect(modules).not.toContain("couriers");
  });

  it("off: a page is not found", async () => {
    await expect(requireCourierPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("every page runs the gate itself", () => {
    const dir = "src/app/dashboard/couriers";
    const pages = (readdirSync(join(root, dir), { recursive: true }) as string[]).filter((f) => f.endsWith("page.tsx"));
    expect(pages).toHaveLength(5);
    for (const page of pages) expect(read(`${dir}/${page}`)).toContain("await requireCourierPage()");
  });

  it("the menu item is drawn only with the flag", () => {
    expect(read("src/app/dashboard/layout.tsx")).toMatch(/href: "\/dashboard\/couriers",[^}]*flag: "courierRegister"/);
  });

  it("no saved sidebar list can hide it: it is not a grant of its own", () => {
    expect(ALL_NAV_ITEMS.some((i) => i.key.startsWith("/dashboard/couriers"))).toBe(false);
    expect(gatedNavKeyForPath("/dashboard/couriers/new")).toBeNull();
  });

  describe("on", () => {
    beforeEach(() => {
      state.flags = { [COURIER_FLAG]: true };
    });

    it.each(["rm", "team_member", "back_office", "branch_head", "service_team", "compliance"])("a %s can record a courier", async (role) => {
      state.roles = [role];
      expect((await calls[1][1]()).status).toBe(201);
    });

    it("a Viewer reads but cannot add, edit, delete or import", async () => {
      state.roles = ["viewer"];
      expect((await calls[0][1]()).status).toBe(200);
      for (const i of [1, 3, 4, 5, 6, 7]) expect((await calls[i][1]()).status).toBe(403);
      await expect(requireCourierPage()).resolves.toMatchObject({ canEdit: false });
    });

    it("Export is offered with the Export data permission, and refused without it", async () => {
      expect(await exportable()).toContain("couriers");
      expect((await calls[8][1]()).status).toBe(200);
      state.roles = ["rm"];
      expect(await exportable()).not.toContain("couriers");
      for (const i of [8, 9]) expect((await calls[i][1]()).status).toBe(403);
      state.permissions = ["data.export"];
      expect(await exportable()).toContain("couriers");
    });

    it("both samples download for whoever may add a courier", async () => {
      state.roles = ["rm"];
      expect((await sampleCall("")).headers.get("content-disposition")).toContain("couriers-import-sample.xlsx");
      const csv = await sampleCall("?format=csv");
      expect(csv.headers.get("content-disposition")).toContain("couriers-import-sample.csv");
      expect(await csv.text()).toContain("Courier Type *,Courier Date *,Courier Company,Tracking Number,Courier Status *");
    });

    it("an invalid courier is refused before the database", async () => {
      const res = await collection.POST(new NextRequest(url, { method: "POST", body: JSON.stringify({ courierType: "inward" }) }));
      expect(res.status).toBe(400);
      expect(state.transactions).toBe(0);
    });
  });
});

describe("migration 0294", () => {
  const sqlText = read("drizzle/migrations/0294_couriers.sql");
  it("forces row-level security with the tenant_isolation policy", () => {
    expect(sqlText).toContain("ALTER TABLE courier_entries ENABLE ROW LEVEL SECURITY");
    expect(sqlText).toContain("ALTER TABLE courier_entries FORCE ROW LEVEL SECURITY");
    expect(sqlText).toContain("CREATE POLICY tenant_isolation ON courier_entries");
  });

  it("switches Couriers on for ARN 110756 only, under the platform-admin context the RLS needs", () => {
    expect(sqlText).toContain(`'{"${COURIER_FLAG}": true}'::jsonb`);
    expect(sqlText).toContain("regexp_replace(t.arn, '[^0-9]', '', 'g') = '110756'");
    expect(sqlText).toContain("app.is_platform_admin");
    expect(sqlText.match(/UPDATE subscriptions/g)).toHaveLength(1);
  });
});
