import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { eq } from "drizzle-orm";
import { Settings2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { attendanceSettings } from "@/db/schema";
import { loadAttendancePolicy } from "@/lib/attendance/settings";
import { AttendanceSettingsForm } from "@/components/attendance/AttendanceSettingsForm";

export const dynamic = "force-dynamic";

export default async function AttendanceSettingsPage() {
  const session = await requireSession();
  const canManage = session.roles.some((r) => ["owner", "branch_head"].includes(r));

  const settings = await withTenant(session.tenantId, async (tx) => {
    const policy = await loadAttendancePolicy(tx, session.tenantId);
    const row = (
      await tx
        .select({ requireGeo: attendanceSettings.requireGeo })
        .from(attendanceSettings)
        .where(eq(attendanceSettings.tenantId, session.tenantId))
        .limit(1)
    )[0];
    return { ...policy, requireGeo: row?.requireGeo ?? false };
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeaderCard title={<><Settings2 className="size-6 text-muted-foreground" /> Attendance settings</>} />

      <AttendanceSettingsForm initial={settings} canManage={canManage} />
    </div>
  );
}
