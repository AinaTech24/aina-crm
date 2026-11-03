import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Personal security settings — self-service 2FA enrollment for the logged-in
 * user. Intentionally NOT gated by an org capability: every user manages their
 * own second factor (it protects their own session), so all that's required is
 * a valid session.
 */

import { eq, sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { ShieldCheck } from "lucide-react";
import { TwoFactorSetup } from "@/components/settings/TwoFactorSetup";
import { FirmSecuritySwitches } from "@/components/settings/FirmSecuritySwitches";
import { can } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const session = await requireSession();
  const sent = (await searchParams).required === "1";
  const isAdmin = can(session.roles, "settings.users", session.permissions);

  // Read the user's own 2FA flag (system context — a user reading their own row).
  const enabled = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT two_fa_enabled FROM users WHERE id = ${session.userId} LIMIT 1
    `);
    return Boolean((r.rows[0] as { two_fa_enabled?: boolean } | undefined)?.two_fa_enabled);
  });

  // The firm's switches (migration 0258) and how many still lack 2FA.
  const firm = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT t.require_2fa, t.ai_enabled,
             (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id AND u.status = 'active' AND u.deleted_at IS NULL) AS team,
             (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id AND u.status = 'active' AND u.deleted_at IS NULL AND u.two_fa_enabled IS NOT TRUE) AS without_2fa
        FROM tenants t WHERE t.id = ${session.tenantId}::uuid`);
    return r.rows[0] as { require_2fa: boolean; ai_enabled: boolean; team: number; without_2fa: number } | undefined;
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<><ShieldCheck className="size-6 text-primary" />
          Security</>} subtitle={<>Signed in as <span className="font-medium">{session.email}</span></>} />

      {firm?.require_2fa && !enabled && (
        <div className="rounded-xl border border-warning/50 bg-warning/5 p-4 text-sm">
          <div className="font-medium">Your firm requires two-factor sign-in</div>
          <p className="text-muted-foreground mt-1">
            {sent ? "Set it up below to carry on using the CRM. " : ""}If it asks you to sign in again first, sign out and back in — you will be taken through the setup.
          </p>
        </div>
      )}

      <TwoFactorSetup initialEnabled={enabled} />

      {isAdmin && firm && (
        <FirmSecuritySwitches
          require2fa={firm.require_2fa}
          aiEnabled={firm.ai_enabled}
          withoutTwoFa={firm.without_2fa}
          teamSize={firm.team}
        />
      )}
    </div>
  );
}
