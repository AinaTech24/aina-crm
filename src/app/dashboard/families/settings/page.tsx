/**
 * Family Master settings — the "Family Setting" and "Family Relationship
 * Management" tiles from the reference, in one page.
 *
 * Readable by anyone who can see households (so an RM can check what the
 * options mean); editable only with settings.masters, since this is firm-wide
 * master data.
 */

import Link from "next/link";
import { HeartHandshake } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { FamilyMasterSettings } from "@/components/families/FamilyMasterSettings";

export const dynamic = "force-dynamic";

export default async function FamilySettingsPage() {
  const session = await requireSession();
  requireAny(
    session.roles,
    ["family.view", "investor.view.all", "investor.view.assigned"],
    session.permissions
  );
  const canEdit = can(session.roles, "settings.masters", session.permissions);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Family settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Defaults for new households and the relationship options your team can choose from.
          </p>
        </div>
        <Link href="/dashboard/families" className="btn-secondary text-sm shrink-0">
          <HeartHandshake className="size-4" /> Family mapping
        </Link>
      </div>

      {!canEdit && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You can see these settings but not change them — that needs the “Manage master data”
          permission.
        </div>
      )}

      <FamilyMasterSettings canEdit={canEdit} />
    </div>
  );
}
