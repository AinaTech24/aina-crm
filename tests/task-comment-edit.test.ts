/**
 * Editing a task comment (2026-11-27): only its author, only on a task they can
 * open, and only newly @mentioned teammates are told.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "11111111-1111-4111-8111-111111111111";
const ASHA = "33333333-3333-4333-8333-333333333333";
const RAVI = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  roles: ["owner"] as string[],
  inScope: true,
  task: null as null | Record<string, unknown>,
  comment: null as null | Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  notified: [] as { userId: string; kind: string }[],
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({
    userId: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    roles: state.roles,
    permissions: null,
    email: "x@t.in",
    name: "X",
  }),
}));
vi.mock("@/lib/auth/license", () => ({ assertActiveLicense: async () => {} }));
vi.mock("@/lib/tasks/scope", () => ({ taskInScope: async () => state.inScope }));
vi.mock("@/lib/tasks/history", () => ({ actAs: async () => {} }));
vi.mock("@/lib/audit", () => ({ recordAudit: async () => {}, clientMetaFromHeaders: () => ({}) }));
vi.mock("@/lib/notifications/create", () => ({
  createNotification: async (_tx: unknown, n: { userId: string; kind: string }) => {
    state.notified.push({ userId: n.userId, kind: n.kind });
  },
}));
vi.mock("@/db/client", async () => {
  const { tasks, taskComments, users } = await import("@/db/schema");
  const rows = (table: unknown): unknown[] => {
    if (table === tasks) return state.task ? [state.task] : [];
    if (table === taskComments) return state.comment ? [state.comment] : [];
    // The users read serves both "which ids are real" and the editor's name.
    if (table === users) return [{ id: "33333333-3333-4333-8333-333333333333", name: "Asha" }, { id: "44444444-4444-4444-8444-444444444444", name: "Ravi" }];
    return [];
  };
  const query = (result: unknown[]): any => {
    const q: any = Promise.resolve(result);
    q.where = () => q;
    q.limit = () => q;
    q.for = () => q;
    return q;
  };
  const tx = {
    select: () => ({ from: (table: unknown) => query(rows(table)) }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push(values);
        return { where: () => ({ returning: async () => [{ ...state.comment, ...values }] }) };
      },
    }),
  };
  return { withTenant: async (_tenant: string, fn: (t: unknown) => unknown) => fn(tx) };
});

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/tasks/[id]/comments/[commentId]/route";

const edit = async (body: unknown) => {
  const res = await PATCH(
    new NextRequest("http://localhost/api/tasks/t/comments/c", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "t", commentId: "c" }) },
  );
  return { status: res.status, json: await res.json() };
};

beforeEach(() => {
  state.roles = ["owner"];
  state.inScope = true;
  state.task = { title: "Call the client", assigneeId: ME, createdById: ME, meta: null };
  state.comment = { id: "c", authorId: ME, body: "test", mentions: [ASHA] };
  state.updates = [];
  state.notified = [];
});

describe("editing a task comment", () => {
  it("saves the author's new text and tells only the newly mentioned", async () => {
    const r = await edit({ body: "  @Asha @Ravi please check  ", mentions: [ASHA, RAVI] });
    expect(r.status).toBe(200);
    expect(r.json.comment.body).toBe("@Asha @Ravi please check");
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].updatedAt).toBeInstanceOf(Date);
    expect(state.notified).toEqual([{ userId: RAVI, kind: "task.mention" }]);
  });

  it("is refused for someone else's comment, even for the owner", async () => {
    state.comment = { ...state.comment, authorId: ASHA };
    expect((await edit({ body: "changed" })).status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("is refused on a task outside the viewer's book", async () => {
    state.inScope = false;
    expect((await edit({ body: "changed" })).status).toBe(404);
    expect(state.updates).toHaveLength(0);
  });

  it("is refused on a deleted or unknown comment", async () => {
    state.comment = null;
    expect((await edit({ body: "changed" })).status).toBe(404);
  });

  it("needs some text", async () => {
    expect((await edit({ body: "   " })).status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("does not mark unchanged text as edited", async () => {
    expect((await edit({ body: "test" })).status).toBe(200);
    expect(state.updates).toHaveLength(0);
  });
});
