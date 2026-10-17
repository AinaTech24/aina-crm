/**
 * G-1: the filter catalog's risk_profile expression is a plain string (the
 * catalog cannot hold a drizzle SQL object), so it must stay identical to
 * clientRiskSql("inv").category — a minor's own assessment, never the
 * guardian's copy. Pure; no database.
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { clientRiskSql } from "@/lib/risk-profile/own-assessment";
import { investorCatalog } from "@/lib/filter/catalog";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("G-1 minor risk SQL", () => {
  it("the filter catalog's risk_profile is clientRiskSql('inv').category", () => {
    const rendered = new PgDialect().sqlToQuery(clientRiskSql("inv").category);
    expect(rendered.params).toEqual([]);
    const field = investorCatalog.fields.find((f) => f.key === "risk_profile")!;
    expect(norm(field.sql)).toBe(norm(rendered.sql));
  });

  it("every expression reads the minor's own assessment and, for others, the row", () => {
    const d = new PgDialect();
    const r = clientRiskSql("i");
    for (const [k, col] of [["category", "risk_profile"], ["score", "risk_profile_score"], ["signedAt", "risk_profile_signed_at"], ["provisional", "risk_profile_provisional"]] as const) {
      const q = norm(d.sqlToQuery(r[k]).sql);
      expect(q).toContain("i.investor_category = 'minor' OR COALESCE(i.is_minor, false)");
      expect(q).toContain("FROM risk_profile_responses r_own");
      expect(q).toContain(`ELSE ${k === "provisional" ? "COALESCE(" : ""}i.${col}`);
    }
  });
});
