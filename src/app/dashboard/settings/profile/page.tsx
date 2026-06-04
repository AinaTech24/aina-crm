import Link from "next/link";
import { eq } from "drizzle-orm";
import { ChevronLeft, UserCircle, ArrowRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { users } from "@/db/schema";
import { primaryRoleLabel } from "@/lib/auth/rbac";
import { LEAVE_ENTITLEMENTS, LEAVE_TYPE_LABELS } from "@/lib/leave/policy";
import ProfileForm from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requireSession();

  const me = await withTenant(session.tenantId, async (tx) => {
    const [u] = await tx
      .select({
        name: users.name,
        email: users.email,
        phone: users.phone,
        department: users.department,
        joiningDate: users.joiningDate,
        annualTarget: users.annualTarget,
        sipMonthlyTarget: users.sipMonthlyTarget,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    return u ?? null;
  });

  const inr = (v: unknown) =>
    v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <UserCircle className="size-5" /> My profile
      </h1>

      {/* Identity (read-only) */}
      <div className="border rounded-lg bg-card p-5 grid sm:grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Email</div>
          <div className="font-medium">{me?.email ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Role</div>
          <div className="font-medium">{primaryRoleLabel(session.roles)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Department</div>
          <div className="font-medium capitalize">{me?.department ?? "—"}</div>
        </div>
      </div>

      {/* Editable details + password */}
      <ProfileForm initialName={me?.name ?? ""} initialPhone={me?.phone ?? ""} />

      {/* Targets */}
      <div className="border rounded-lg bg-card p-5">
        <h3 className="font-semibold text-sm mb-3">My targets</h3>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Annual business target</div>
            <div className="text-lg font-bold">{inr(me?.annualTarget)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Monthly SIP target</div>
            <div className="text-lg font-bold">{inr(me?.sipMonthlyTarget)}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Targets are set by your firm owner.</p>
      </div>

      {/* Leave entitlements */}
      <div className="border rounded-lg bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">My leave (annual entitlement)</h3>
          <Link href="/dashboard/leave-applications" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Apply / view <ArrowRight className="size-3" />
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(LEAVE_ENTITLEMENTS).map(([type, days]) => (
            <div key={type} className="rounded-md border bg-background px-3 py-2">
              <div className="text-xs text-muted-foreground">{LEAVE_TYPE_LABELS[type] ?? type}</div>
              <div className="text-lg font-bold">{days == null ? "Unpaid" : `${days} days`}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
