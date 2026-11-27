/**
 * Team logins without an email address (2026-11-27): sign in with a username. The stored address is
 * on a reserved domain that can never receive mail, and is never mailed to or shown to a client.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isUsernameLogin, loginLabel, realEmail, signInKey, usernameAddress, usernameProblem } from "@/lib/auth/username-login";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("username logins", () => {
  it("turns what is typed on the sign-in screen into the stored sign-in address", () => {
    expect(signInKey("  Ravi.Shah ")).toBe("ravi.shah@login.invalid");
    expect(signInKey(" Meera@Firm.IN ")).toBe("meera@firm.in");
    expect(signInKey("")).toBe("");
  });

  it("shows the username and never offers it as an email address", () => {
    const stored = usernameAddress("ravi");
    expect(isUsernameLogin(stored)).toBe(true);
    expect(loginLabel(stored)).toBe("ravi");
    expect(realEmail(stored)).toBeNull();
    expect(realEmail("meera@firm.in")).toBe("meera@firm.in");
    expect(loginLabel("meera@firm.in")).toBe("meera@firm.in");
    expect(realEmail(null)).toBeNull();
    expect(isUsernameLogin("someone@notlogin.invalid.com")).toBe(false);
  });

  it("accepts simple usernames only", () => {
    for (const ok of ["ravi", "ravi.shah", "ops_2", "a-b-c"]) expect(usernameProblem(ok)).toBeNull();
    for (const bad of ["ab", "ravi@x.in", ".ravi", "ravi.", "ra..vi", "ravi shah", "x".repeat(41)]) {
      expect(usernameProblem(bad)).not.toBeNull();
    }
  });

  it("is honoured by both sign-in routes, and no mail path sends to a username", () => {
    for (const p of ["src/app/api/auth/login/route.ts", "src/app/api/auth/mobile-login/route.ts"]) {
      expect(read(p)).toContain("signInKey(String(body.email");
    }
    expect(read("src/lib/comms/adapters/resend.ts")).toContain("isUsernameLogin(input.recipient)");
    expect(read("src/lib/comms/system-email.ts")).toContain("isUsernameLogin(args.to)");
    expect(read("src/lib/comms/pipeline.ts")).toContain("realEmail(rm?.email)");
  });

  it("keeps the username working after an email is added, and guards who may add it", () => {
    for (const p of ["src/app/api/auth/login/route.ts", "src/app/api/auth/mobile-login/route.ts"]) {
      expect(read(p)).toContain("OR lower(u.login_username) = ${username}");
    }
    const route = read("src/app/api/employees/[id]/email/route.ts");
    expect(route).toContain('requireCap(session.roles, "settings.users"');
    expect(route).toContain("login_username = ${name}, email_verified_at = NULL");
    expect(route).toContain("This team member already signs in with an email address."); // username logins only
    expect(route).toContain("FROM user_invites"); // a pending invite would take the login over
    expect(route).toContain("consumed_at = now()"); // open reset links are voided
    expect(read("src/app/api/employees/create-login/route.ts")).toContain("OR lower(login_username) = ${username}");
    expect(read("drizzle/migrations/0298_user_login_username.sql")).toContain("ADD COLUMN IF NOT EXISTS login_username");
  });

  it("creates a login only for a user manager, within the seat limit, with a unique username", () => {
    const route = read("src/app/api/employees/create-login/route.ts");
    expect(route).toContain('requireCap(session.roles, "settings.users"');
    expect(route).toContain("license.maxUsers");
    expect(route).toContain("pg_advisory_xact_lock");
    expect(route).toContain("areAssignableRoles(b.roles)");
    expect(route).toContain("Only an owner can create another owner.");
  });
});
