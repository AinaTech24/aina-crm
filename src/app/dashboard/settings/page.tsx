import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { SettingsDirectory } from "@/components/settings/SettingsDirectory";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { navEnabledForUser } from "@/lib/nav/enabled-for-user";

export const dynamic = "force-dynamic";

/**
 * Pages that moved here from the sidebar (2026-10-01) keep the sidebar's
 * access rules — its roles, plus the module kill-switch and the firm / user
 * nav grants (`navEnabledForUser`, under `key` when it differs from the href) —
 * so a card shows only to someone the menu would have shown the page to.
 * Mirror the item's `roles` / `accessKey` in PALETTE_ONLY (dashboard/layout.tsx).
 */
const DATA_ADMIN_ROLES = ["owner", "back_office", "ops"];
const GATED: Array<{ href: string; key?: string; roles?: string[] }> = [
  { href: "/dashboard/communications" },
  { href: "/dashboard/templates" },
  { href: "/dashboard/automations", key: "/dashboard/workflows/rules" },
  { href: "/dashboard/employees", roles: ["owner", "branch_head"] },
  { href: "/dashboard/schemes", roles: DATA_ADMIN_ROLES },
  { href: "/dashboard/amc-empanelments", roles: DATA_ADMIN_ROLES },
];

/** The sections, their order and the search live in SettingsDirectory. */
export default async function SettingsPage() {
  const session = await requireSession();
  const userModules = await withTenant(session.tenantId, async (tx) => {
    const [u] = await tx.select({ m: users.enabledModules }).from(users).where(eq(users.id, session.userId)).limit(1);
    return (u?.m as string[] | null) ?? null;
  });
  const hidden: string[] = [];
  for (const g of GATED) {
    const roleOk = !g.roles || session.roles.some((r) => r === "owner" || g.roles!.includes(r));
    if (!roleOk || !(await navEnabledForUser(session, userModules, g.key ?? g.href))) hidden.push(g.href);
  }
  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeaderCard title={<>Settings</>} />
      <SettingsDirectory hidden={hidden} />
    </div>
  );
}
