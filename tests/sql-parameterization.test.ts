import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { supportTicketListQuery, supportTicketWhere } from "@/lib/support/ticket-list";
import { boundTextArray, boundUuidArray } from "@/lib/sql/bound-array";

const dialect = new PgDialect();
const compile = (q: ReturnType<typeof sql>) => dialect.sqlToQuery(q);

const MALICIOUS = [
  "' OR 1=1 --",
  "open'; DROP TABLE support_tickets; --",
  "open\\'; SELECT pg_sleep(10); --",
  "open\" OR \"1\"=\"1",
  "$$; DELETE FROM users; $$",
  "open) OR (1=1",
  "open\u0000",
  "ओपन 😀 ' --",
  "x".repeat(10_000),
  "/* comment */ open",
  "open;",
];

describe("Support tickets list: URL filters are bound parameters", () => {
  it("binds every filter value and never puts it in the SQL text", () => {
    for (const evil of MALICIOUS) {
      const q = compile(supportTicketListQuery({ status: evil, category: evil, priority: evil }));
      expect(q.params).toEqual([evil, evil, evil]);
      expect(q.sql).not.toContain(evil);
      // The statement shape is fixed whatever the input: three placeholders in the WHERE.
      expect(q.sql).toMatch(/WHERE st\.status = \$1 AND st\.category = \$2 AND st\.priority = \$3/);
      // Still exactly one statement.
      expect(q.sql.match(/;/g)).toBeNull();
    }
  });

  it("filters exactly as before: each param alone, together, and none", () => {
    expect(compile(supportTicketWhere({})).sql.trim()).toBe("");
    const s = compile(supportTicketWhere({ status: "open" }));
    expect(s.sql).toBe("WHERE st.status = $1");
    expect(s.params).toEqual(["open"]);
    const c = compile(supportTicketWhere({ category: "billing" }));
    expect(c.sql).toBe("WHERE st.category = $1");
    const p = compile(supportTicketWhere({ priority: "urgent" }));
    expect(p.sql).toBe("WHERE st.priority = $1");
    const all = compile(supportTicketWhere({ status: "in_progress", category: "bug", priority: "high" }));
    expect(all.sql).toBe("WHERE st.status = $1 AND st.category = $2 AND st.priority = $3");
    expect(all.params).toEqual(["in_progress", "bug", "high"]);
  });

  it("handles malformed params: empty, repeated (array) and missing", () => {
    expect(compile(supportTicketWhere({ status: "", category: undefined })).sql.trim()).toBe("");
    const rep = compile(supportTicketWhere({ status: ["open", "' OR 1=1 --"] }));
    expect(rep.sql).toBe("WHERE st.status = $1");
    expect(rep.params).toEqual(["open"]);
    expect(compile(supportTicketWhere({ status: [] as string[] })).sql.trim()).toBe("");
  });

  it("keeps the list's order and limit", () => {
    const q = compile(supportTicketListQuery({}));
    expect(q.sql).toContain("LIMIT 200");
    expect(q.sql).toContain("st.created_at DESC");
    expect(q.params).toEqual([]);
  });
});

describe("bound arrays replace hand-built ARRAY['…'] literals", () => {
  it("binds each uuid element", () => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const q = compile(sql`SELECT 1 WHERE id = ANY(${boundUuidArray(ids)})`);
    expect(q.sql).toBe("SELECT 1 WHERE id = ANY(ARRAY[$1, $2]::uuid[])");
    expect(q.params).toEqual(ids);
  });

  it("a malicious element stays a parameter", () => {
    for (const evil of MALICIOUS) {
      const q = compile(sql`SELECT 1 WHERE roles && ${boundTextArray(["rm", evil])}`);
      expect(q.sql).toBe("SELECT 1 WHERE roles && ARRAY[$1, $2]::text[]");
      expect(q.params).toEqual(["rm", evil]);
    }
  });

  it("an empty list is a valid empty array", () => {
    expect(compile(sql`${boundUuidArray([])}`).sql).toBe("ARRAY[]::uuid[]");
    expect(compile(sql`${boundTextArray([])}`).params).toEqual([]);
  });
});
