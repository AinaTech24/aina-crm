/**
 * Filter-bar choices for one viewer. SERVER-ONLY. RM and Branch lists are cut
 * to what the viewer's access reaches, so a branch head cannot pick an RM from
 * another branch, and an RM gets no RM list at all.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { LEAD_SOURCE_VALUES } from "@/lib/leads/normalize";
import { humanise } from "@/lib/format";
import type { DataAccess } from "./system/access";
import { CATEGORY_OPTIONS, PRODUCT_OPTIONS, SEGMENT_OPTIONS, type FilterOptions, type Option } from "./system/options";
import type { FilterKey } from "./system/filters";

const stripRole = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, "").trim() || n;

/** Branches that are real (a placeholder "Unassigned" branch does not count). */
export async function realBranches(tx: Tx, tenantId: string): Promise<Array<{ id: string; name: string }>> {
  return (await tx.execute(sql`
    SELECT id, name FROM branches
     WHERE tenant_id = ${tenantId}::uuid AND COALESCE(name, '') !~* '^\\s*(unassigned|none|no branch)\\s*$'
     ORDER BY name
  `)).rows as Array<{ id: string; name: string }>;
}

export async function loadFilterOptions(
  tx: Tx, tenantId: string, access: DataAccess, wanted: FilterKey[],
): Promise<FilterOptions> {
  const out: FilterOptions = {};
  const want = new Set(wanted);
  if (want.has("rm") && access.kind === "team") {
    // A team lead picks among the people who report to them.
    const ids = access.memberIds.filter((id) => id !== access.userId);
    const rows = ids.length ? (await tx.execute(sql`
      SELECT id, name FROM users
       WHERE tenant_id = ${tenantId}::uuid AND id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
       ORDER BY name
    `)).rows as Array<{ id: string; name: string | null }> : [];
    out.rm = [{ value: "me", label: "Me" }, ...rows.map((r) => ({ value: r.id, label: stripRole(r.name ?? "—") }))];
  } else if (want.has("rm") && access.kind !== "self") {
    const rows = (await tx.execute(sql`
      SELECT id, name FROM users
       WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
         AND (roles && ARRAY['rm', 'branch_head', 'owner']::text[]
              OR id IN (SELECT DISTINCT rm_id FROM investors WHERE tenant_id = ${tenantId}::uuid AND rm_id IS NOT NULL AND deleted_at IS NULL))
         ${access.kind === "branch" ? sql`AND branch_id = ${access.branchId}::uuid` : sql``}
       ORDER BY name
    `)).rows as Array<{ id: string; name: string | null }>;
    out.rm = [{ value: "me", label: "Me" }, ...rows.map((r) => ({ value: r.id, label: stripRole(r.name ?? "—") }))];
  }
  if (want.has("branch") && access.kind === "firm") {
    out.branch = (await realBranches(tx, tenantId)).map((b) => ({ value: b.id, label: b.name }));
  }
  if (want.has("segment")) out.segment = SEGMENT_OPTIONS;
  if (want.has("category")) out.category = CATEGORY_OPTIONS;
  if (want.has("product")) out.product = PRODUCT_OPTIONS;
  if (want.has("leadSource")) out.leadSource = LEAD_SOURCE_VALUES.map((v) => ({ value: v, label: humanise(v) }));
  if (want.has("amc")) {
    const rows = (await tx.execute(sql`
      SELECT DISTINCT amc_name FROM (
        SELECT amc_name FROM sips WHERE tenant_id = ${tenantId}::uuid AND amc_name IS NOT NULL
        UNION SELECT amc_name FROM folios WHERE tenant_id = ${tenantId}::uuid AND amc_name IS NOT NULL
      ) a WHERE btrim(amc_name) <> '' ORDER BY amc_name LIMIT 300
    `)).rows as Array<{ amc_name: string }>;
    out.amc = rows.map((r) => ({ value: r.amc_name, label: r.amc_name }));
  }
  if (want.has("tags")) {
    const rows = (await tx.execute(sql`
      SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM investors
       WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND jsonb_typeof(tags) = 'array'
       ORDER BY 1 LIMIT 300
    `)).rows as Array<{ tag: string }>;
    out.tags = rows.map((r) => ({ value: r.tag, label: r.tag }));
  }
  if (want.has("family")) {
    const rows = (await tx.execute(sql`
      SELECT id, COALESCE(family_name, head_name, 'Family') AS name FROM families
       WHERE tenant_id = ${tenantId}::uuid ORDER BY 2 LIMIT 500
    `)).rows as Array<{ id: string; name: string }>;
    out.family = rows.map((r) => ({ value: r.id, label: r.name }));
  }
  return out;
}

export type { Option };
