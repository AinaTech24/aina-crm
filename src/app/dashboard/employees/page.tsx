import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, UserCog, AlertTriangle, Target, IndianRupee, ShieldCheck, Network, Upload } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { formatDate, formatINR } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { EmployeeRowActions } from "@/components/employees/EmployeeRowActions";
import { TeamPresence } from "@/components/employees/TeamPresence";
import { ExportButton } from "@/components/export/ExportButton";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  invited: "bg-blue-50 text-blue-700",
  suspended: "bg-rose-50 text-rose-700",
  offboarding: "bg-amber-50 text-amber-700",
  offboarded: "bg-secondary text-foreground",
};

export const dynamic = "force-dynamic";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const deptFilter = (sp.department ?? "").split(",").filter(Boolean);
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  // Offboarded people are hidden unless asked for — by the "Show offboarded"
  // switch, or by filtering on that status directly.
  const showOffboarded = sp.offboarded === "1" || statusFilter.includes("offboarded");
  const incompleteOnly = sp.incomplete === "1";

  const { rows: data, offboardedCount, incompleteCount } = await withTenant(session.tenantId, async (tx) => {
    // Trashed (soft-deleted) employees live in the Trash bin, not the team list.
    const conds: any[] = [sql`u.deleted_at IS NULL`];
    if (q) {
      conds.push(
        sql`(u.name ILIKE ${`%${q}%`} OR u.email ILIKE ${`%${q}%`} OR u.phone ILIKE ${`%${q}%`} OR u.euin ILIKE ${`%${q}%`})`
      );
    }
    if (deptFilter.length) {
      conds.push(
        sql`u.department IN (${sql.join(deptFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (statusFilter.length) {
      conds.push(
        sql`u.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (!showOffboarded) conds.push(sql`u.status <> 'offboarded'`);
    // "Complete team profiles": people missing a department, manager or joining date.
    if (incompleteOnly) {
      conds.push(sql`(u.department IS NULL OR u.reporting_manager_id IS NULL OR u.joining_date IS NULL)`);
    }
    const whereSql = conds.length ? sql` WHERE ${sql.join(conds, sql` AND `)}` : sql``;

    const employees = await tx.execute(sql`
      SELECT u.id, u.name, u.email, u.phone, u.roles, u.status,
             u.department, u.joining_date, u.annual_target, u.sip_monthly_target,
             u.reporting_manager_id, mgr.name AS manager_name,
             u.euin, u.nism_expiry_at, u.last_login_at, u.created_at,
             (SELECT COUNT(*)::int FROM investors i WHERE i.rm_id = u.id AND i.status = 'active') AS assigned_clients,
             (SELECT COALESCE(SUM(i.aum::numeric), 0)::numeric FROM investors i WHERE i.rm_id = u.id AND i.status = 'active') AS my_aum
      FROM users u
      LEFT JOIN users mgr ON mgr.id = u.reporting_manager_id
      ${whereSql}
      ORDER BY u.created_at DESC
    `);
    // How many are hidden, for the switch's count and the note under the table.
    const off = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM users u WHERE u.deleted_at IS NULL AND u.status = 'offboarded'
    `);
    // Current (not offboarded) members whose profile lacks a department,
    // manager or joining date — the reason those columns are empty.
    const gaps = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM users u
       WHERE u.deleted_at IS NULL AND u.status <> 'offboarded'
         AND (u.department IS NULL OR u.reporting_manager_id IS NULL OR u.joining_date IS NULL)
    `);
    return {
      rows: employees.rows as any[],
      offboardedCount: Number((off.rows[0] as { c?: number } | undefined)?.c ?? 0),
      incompleteCount: Number((gaps.rows[0] as { c?: number } | undefined)?.c ?? 0),
    };
  });

  const stats = {
    total: data.length,
    active: data.filter((e) => e.status === "active").length,
    nismExpiring: data.filter(
      (e) => e.nism_expiry_at && new Date(e.nism_expiry_at).getTime() - Date.now() < 90 * 24 * 60 * 60 * 1000
    ).length,
    targetedRms: data.filter((e) => Number(e.annual_target ?? 0) > 0).length,
  };

  const hasDept = data.some((e: any) => !!e.department);
  const hasManager = data.some((e: any) => !!e.manager_name);
  const hasJoined = data.some((e: any) => !!e.joining_date);

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><UserCog className="size-6 text-muted-foreground" /> Team Members</>} actions={<><div className="flex items-center gap-2">
          <TeamPresence members={data.map((e) => ({ id: e.id, name: e.name }))} />
          <Link href="/dashboard/employees/org" className="rounded-md border px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-secondary">
            <Network className="size-4" /> Org chart
          </Link>
          <Link href="/dashboard/employees/compliance" className="rounded-md border px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-secondary">
            <ShieldCheck className="size-4" /> Licensing
          </Link>
          <Link href="/dashboard/employees/import" className="rounded-md border px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-secondary">
            <Upload className="size-4" /> Import
          </Link>
          <ExportButton module="team-members" />
          <Link
            href="/dashboard/employees/new"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Invite employee
          </Link>
        </div></>} />

      {/* Department / Manager / Joined are hidden while nobody has them filled;
          this says why and opens exactly the profiles to complete. */}
      {incompleteCount > 0 && !incompleteOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm">
          <span className="text-foreground">
            {incompleteCount === 1 ? "1 team member has" : `${incompleteCount} team members have`} no department, manager or
            joining date{!hasDept || !hasManager || !hasJoined ? ", so those columns are hidden" : ""}.
          </span>
          <Link href="/dashboard/employees?incomplete=1" className="font-medium text-foreground underline-offset-2 hover:underline">
            Complete team profiles →
          </Link>
        </div>
      )}
      {incompleteOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm">
          <span className="text-foreground">Showing team members missing a department, manager or joining date. Open each to fill them in.</span>
          <Link href="/dashboard/employees" className="font-medium text-foreground underline-offset-2 hover:underline">
            Show everyone
          </Link>
        </div>
      )}

      <CompactFilterBar
        totalCount={data.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by name, email, phone, EUIN…" },
          {
            type: "multi",
            key: "department",
            label: "Department",
            options: [
              { value: "sales", label: "Sales" },
              { value: "operations", label: "Operations" },
              { value: "back_office", label: "Back Office" },
              { value: "compliance", label: "Compliance" },
              { value: "marketing", label: "Marketing" },
              { value: "advisory", label: "Advisory" },
              { value: "support", label: "Support" },
              { value: "leadership", label: "Leadership" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "invited", label: "Invited" },
              { value: "suspended", label: "Suspended" },
              { value: "offboarding", label: "Offboarding" },
              { value: "offboarded", label: "Offboarded" },
            ],
          },
          {
            type: "flags",
            label: "Show",
            options: [{ key: "offboarded", label: "Show offboarded", count: offboardedCount }],
          },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:employees"
            presets={[
              { id: "active", name: "Active only", params: "status=active" },
              { id: "sales", name: "Sales team", params: "department=sales,advisory" },
              { id: "ops", name: "Operations team", params: "department=operations,back_office" },
              { id: "compliance", name: "Compliance", params: "department=compliance" },
            ]}
          />
        }
      />

      <div className="card-surface overflow-hidden">
        {data.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <UserCog className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">
              {incompleteOnly ? "Every team profile is complete." : "No team members match these filters."}
            </div>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Employee</th>
                  {hasDept && <th className="text-left py-2 font-medium">Department</th>}
                  {hasManager && <th className="text-left py-2 font-medium">Manager</th>}
                  {hasJoined && <th className="text-left py-2 font-medium">Joined</th>}
                  <th className="text-left py-2 font-medium">Roles</th>
                  <th className="text-right py-2 font-medium">Clients</th>
                  <th className="text-right py-2 font-medium">AUM</th>
                  <th className="text-right py-2 font-medium">Target</th>
                  <th className="text-left py-2 font-medium">NISM</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="text-right py-2 font-medium pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e) => {
                  const nismExpiry = e.nism_expiry_at ? new Date(e.nism_expiry_at) : null;
                  const nismDays = nismExpiry ? Math.floor((nismExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;
                  return (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-secondary/40">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/employees/${e.id}`} className="font-medium hover:underline">
                          {e.name}
                        </Link>
                        <div className="text-2xs text-muted-foreground">{e.email}</div>
                        {e.phone && <div className="text-2xs text-muted-foreground font-mono">{e.phone}</div>}
                      </td>
                      {hasDept && (
                        <td className="py-3 text-xs capitalize">
                          {e.department ? e.department.replace(/_/g, " ") : ""}
                        </td>
                      )}
                      {hasManager && <td className="py-3 text-xs">{e.manager_name ?? ""}</td>}
                      {hasJoined && (
                        <td className="py-3 text-xs text-muted-foreground tabular-nums">
                          {e.joining_date ? formatDate(e.joining_date) : ""}
                        </td>
                      )}
                      <td className="py-3 text-xs">
                        {(() => {
                          // back_office and ops share a label — show it once.
                          const labels = [...new Set(((e.roles ?? []) as string[]).map((r) => ROLE_LABELS[r] ?? r))];
                          const rest = labels.slice(2);
                          return (
                            <div className="flex flex-wrap items-center gap-1">
                              {labels.slice(0, 2).map((l) => (
                                <span key={l} className="chip text-2xs bg-secondary text-foreground whitespace-nowrap">{l}</span>
                              ))}
                              {rest.length > 0 && (
                                <span className="chip text-2xs bg-secondary text-muted-foreground" title={rest.join(", ")}>
                                  +{rest.length}
                                  <span className="sr-only"> more: {rest.join(", ")}</span>
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-3 text-right tabular-nums">{e.assigned_clients}</td>
                      <td className="py-3 text-right tabular-nums text-muted-foreground">
                        {Number(e.my_aum ?? 0) > 0 ? formatINR(Number(e.my_aum)) : ""}
                      </td>
                      <td className="py-3 text-right text-xs">
                        {Number(e.annual_target ?? 0) > 0 ? (
                          (() => {
                            const annualTarget = Number(e.annual_target);
                            const myAum = Number(e.my_aum ?? 0);
                            const progress = Math.round((myAum / annualTarget) * 100);
                            const progressColor =
                              progress >= 100 ? "bg-emerald-500 text-emerald-700" : progress > 0 ? "bg-foreground/40 text-foreground" : "bg-secondary text-muted-foreground";
                            return (
                              <div className="flex flex-col items-end gap-1">
                                <span className="font-medium tabular-nums text-foreground">
                                  {formatINR(annualTarget)}
                                </span>
                                <div className="w-16 h-1 bg-secondary rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${progressColor.split(" ")[0]}`}
                                    style={{ width: `${Math.min(100, progress)}%` }}
                                  />
                                </div>
                                <span className={`text-2xs font-semibold tabular-nums ${progressColor.split(" ")[1]}`}>
                                  {progress}%
                                </span>
                              </div>
                            );
                          })()
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="py-3 text-xs">
                        {nismExpiry ? (
                          <span className={nismDays != null && nismDays < 90 ? "text-amber-600" : ""}>
                            {nismDays != null && nismDays < 30 && (
                              <AlertTriangle className="size-3 inline mr-1 text-rose-600" />
                            )}
                            {formatDate(nismExpiry)}
                          </span>
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="py-3">
                        <span className={`chip ${STATUS_COLORS[e.status] ?? ""}`}>{e.status}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <EmployeeRowActions
                          employee={{
                            id: e.id,
                            name: e.name,
                            email: e.email ?? null,
                            phone: e.phone ?? null,
                            status: e.status,
                            department: e.department ?? null,
                            managerName: e.manager_name ?? null,
                            roles: (e.roles ?? []) as string[],
                            assignedClients: Number(e.assigned_clients ?? 0),
                            aum: Number(e.my_aum ?? 0),
                            joiningDate: e.joining_date ? String(e.joining_date) : null,
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!showOffboarded && offboardedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {offboardedCount} offboarded {offboardedCount === 1 ? "person is" : "people are"} hidden.{" "}
          <Link href="/dashboard/employees?offboarded=1" className="font-medium text-foreground hover:underline">
            Show offboarded
          </Link>
        </p>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone?: "emerald" | "amber" | "muted" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
