/**
 * We Care Freedom Wealth (ARN-249212) may create up to 70 users (2026-11-28), with no change to
 * what it pays: the allowance is its own column, read for the limit and never for a price.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { userLimit } from "@/lib/billing/user-limit";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the user limit", () => {
  it("is the higher of what was bought (or the package) and the firm's allowance", () => {
    expect(userLimit({ seatsOverride: null, userLimitOverride: 70 }, { maxUsers: 25 })).toBe(70);
    expect(userLimit({ seatsOverride: 1, userLimitOverride: 70 }, { maxUsers: 25 })).toBe(70); // a purchase keeps it
    expect(userLimit({ seatsOverride: 100, userLimitOverride: 70 }, { maxUsers: 25 })).toBe(100);
    expect(userLimit({ seatsOverride: null, userLimitOverride: null }, { maxUsers: 25 })).toBe(25);
    expect(userLimit({ seatsOverride: 5 }, { maxUsers: 25 })).toBe(5);
    expect(userLimit(null, null)).toBe(1);
  });

  it("is what the sign-up checks and the usage bar read, while no price reads the allowance", () => {
    expect(read("src/lib/auth/license.ts")).toContain("maxUsers: userLimit(sub, pkg),");
    expect(read("src/app/dashboard/billing/page.tsx")).toContain("seatLimit: userLimit(s, p),");
    for (const p of ["src/lib/billing/billing-view.ts", "src/lib/billing/razorpay.ts", "src/lib/billing/payments.ts", "src/lib/billing/renewal-review.ts"]) {
      expect(read(p)).not.toMatch(/userLimitOverride|user_limit_override/);
    }
    expect(read("src/app/dashboard/billing/page.tsx")).toContain("seats={sub.seatsOverride ?? pkg.maxUsers}"); // priced as before
  });

  it("grants it to that one firm only, touching no seat count or package", () => {
    const sql = read("drizzle/migrations/0302_we_care_freedom_wealth_users.sql")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS user_limit_override integer");
    expect(sql).toContain("SET user_limit_override = 70");
    expect(sql).toContain("regexp_replace(t.arn, '[^0-9]', '', 'g') = '249212'");
    expect(sql).not.toContain("seats_override");
    expect(sql).not.toMatch(/UPDATE\s+packages/i);
    expect(sql).toContain("set_config('app.is_platform_admin', 'true', true)");
  });
});
