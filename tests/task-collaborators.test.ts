/**
 * Collaborators on a task (2026-11-27): they see it and work on it with the
 * assignee; deleting it and changing who is on it stay with the assignee, the
 * creator and task.edit.all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ASSIGNEE = "11111111-1111-4111-8111-111111111111";
const HELPER = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const CREATOR = "55555555-5555-4555-8555-555555555555";

const state = vi.hoisted(() => ({
  userId: "",
  task: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  shared: [] as string[][],
  notified: [] as { userId: string; kind: string }[],
}));

vi.mock("@/lib/auth/session", () => ({
  // task.view.assigned + task.edit.assigned only.
  requireSession: async () => ({
    userId: state.userId, tenantId: "22222222-2222-4222-8222-222222222222",
    roles: ["rm"], permissions: null, email: "x@t.in", name: "X", branchId: null,
  }),
}));
vi.mock("@/lib/auth/license", () => ({ assertActiveLicense: async () => {} }));
vi.mock("@/lib/tasks/scope", () => ({ taskInScope: async () => true }));
vi.mock("@/lib/audit", () => ({ recordAudit: async () => {}, clientMetaFromHeaders: () => ({}) }));
vi.mock("@/lib/tasks/watchers", () => ({ notifyWatchers: async () => {} }));
vi.mock("@/lib/tasks/collaborators-server", () => ({ assertCollaborators: async () => {} }));
vi.mock("@/lib/tasks/collaborator-notify", () => ({
  notifyCollaboratorsAdded: async (_tx: unknown, o: { userIds: string[] }) => { state.shared.push(o.userIds); },
}));
vi.mock("@/lib/notifications/create", () => ({
  createNotification: async (_tx: unknown, n: { userId: string; kind: string }) => {
    state.notified.push({ userId: n.userId, kind: n.kind });
  },
}));
vi.mock("@/lib/business/create-entry", () => ({ syncTaskBusinessEntry: async () => {} }));
vi.mock("@/lib/tasks/recurrence", () => ({ spawnNextOccurrence: async () => null }));
vi.mock("@/lib/api/idempotent-mutation", async () => {
  const { tasks } = await import("@/db/schema");
  const query = (result: unknown[]): any => {
    const q: any = Promise.resolve(result);
    q.where = () => q;
    q.limit = () => q;
    return q;
  };
  const tx = {
    select: () => ({ from: (table: unknown) => query(table === tasks ? [state.task] : [{ id: "u", name: "Someone" }]) }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push(values);
        return { where: () => ({ returning: async () => [{ ...state.task, ...values }] }) };
      },
    }),
    execute: async () => ({ rows: [] }),
  };
  return { withIdempotentMutation: async (_s: unknown, _r: unknown, _b: unknown, fn: (t: unknown) => unknown) => fn(tx) };
});

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/tasks/[id]/route";
import { cleanCollaborators, collaboratorsOf, worksOnTask } from "@/lib/tasks/collaborators";
import { worksOnSql } from "@/lib/tasks/collaborators-sql";
import { describeChanges } from "@/lib/tasks/history-format";

const patch = async (userId: string, body: unknown) => {
  state.userId = userId;
  const res = await PATCH(
    new NextRequest("http://localhost/api/tasks/t", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "t" }) },
  );
  return res.status;
};

beforeEach(() => {
  state.task = {
    id: "t", title: "Call the client", status: "open", priority: "normal",
    assigneeId: ASSIGNEE, createdById: CREATOR, collaboratorIds: [HELPER], meta: null,
  };
  state.updates = [];
  state.shared = [];
  state.notified = [];
});

describe("who is on a task", () => {
  it("counts the assignee and the collaborators", () => {
    expect(worksOnTask(state.task, ASSIGNEE)).toBe(true);
    expect(worksOnTask(state.task, HELPER)).toBe(true);
    expect(worksOnTask(state.task, OTHER)).toBe(false);
    expect(collaboratorsOf({})).toEqual([]);
  });

  it("never lists the assignee twice", () => {
    expect(cleanCollaborators([HELPER, ASSIGNEE, HELPER], ASSIGNEE)).toEqual([HELPER]);
  });

  it("is read from both places by the database query", () => {
    const q = new PgDialect().sqlToQuery(worksOnSql(HELPER, "t"));
    expect(q.sql).toBe("(t.assignee_id = $1::uuid OR t.collaborator_ids ? $2)");
    expect(q.params).toEqual([HELPER, HELPER]);
  });
});

describe("editing a shared task", () => {
  it("lets a collaborator work on it, and tells the assignee", async () => {
    expect(await patch(HELPER, { status: "in_progress", assigneeId: ASSIGNEE, collaboratorIds: [HELPER] })).toBe(200);
    expect(state.updates[0].status).toBe("in_progress");
    expect(state.updates[0]).not.toHaveProperty("collaboratorIds");
    expect(state.notified).toContainEqual({ userId: ASSIGNEE, kind: "task.status_changed" });
  });

  it("does not let a collaborator change who works on it", async () => {
    expect(await patch(HELPER, { collaboratorIds: [HELPER, OTHER] })).toBe(403);
    expect(await patch(HELPER, { assigneeId: OTHER })).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("stays closed to someone who is not on it", async () => {
    expect(await patch(OTHER, { status: "completed" })).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("lets the assignee add a teammate, who is told", async () => {
    expect(await patch(ASSIGNEE, { collaboratorIds: [HELPER, OTHER] })).toBe(200);
    expect(state.updates[0].collaboratorIds).toEqual([HELPER, OTHER]);
    expect(state.shared).toEqual([[OTHER]]);
  });

  it("drops a collaborator who becomes the assignee", async () => {
    expect(await patch(CREATOR, { assigneeId: HELPER })).toBe(200);
    expect(state.updates[0].collaboratorIds).toEqual([]);
  });
});

describe("the timeline", () => {
  it("names the collaborators added", () => {
    const [line] = describeChanges(
      { collaborator_ids: { from: [], to: [HELPER, OTHER] } },
      { users: new Map([[HELPER, "Asha"], [OTHER, "Ravi"]]), records: new Map() },
    );
    expect(line).toMatchObject({ label: "Collaborators", from: null, to: "Asha, Ravi" });
  });

  it("still records every column it did before", () => {
    const tracked = (file: string) => {
      const sql = readFileSync(join(__dirname, "..", "drizzle", "migrations", file), "utf8");
      const list = /tracked text\[\] := ARRAY\[([\s\S]*?)\];/.exec(sql)![1];
      return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    expect(tracked("0301_task_collaborators.sql").sort()).toEqual(
      [...tracked("0284_task_history.sql"), "collaborator_ids"].sort(),
    );
  });
});
