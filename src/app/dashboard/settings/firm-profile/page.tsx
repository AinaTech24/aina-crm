/**
 * Firm profile — consolidated view of every regulator-facing data point
 * about the firm. Network FP "1.6 Firm Details" template parity.
 *
 * Pulls from FIVE sources and renders one printable page:
 *   - tenants (basic + tax + bank + signatory)
 *   - firm_directors (board / partner list)
 *   - branches (registered office + branch offices)
 *   - users (employee count + active count)
 *   - legal_registrations (all SEBI / AMFI / IRDAI / etc. licenses)
 *
 * Designed to be print-friendly — owners often print this for SEBI
 * inspection or DDQ submission.
 */

import { eq, count, and, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import {
  tenants,
  firmDirectors,
  branches,
  users,
  legalRegistrations,
} from "@/db/schema";
import { FirmProfileEditor } from "@/components/settings/FirmProfileEditor";
import { PrintButton } from "@/components/settings/PrintButton";

export const dynamic = "force-dynamic";

export default async function FirmProfilePage() {
  const session = await requireSession();
  requireCap(session.roles, "settings.users");
  await assertActiveLicense(session.tenantId, session.roles);

  const data = await withTenant(session.tenantId, async (tx) => {
    const [tenant] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);

    const directors = await tx
      .select()
      .from(firmDirectors)
      .where(eq(firmDirectors.tenantId, session.tenantId))
      .orderBy(firmDirectors.name);

    const branchRows = await tx
      .select()
      .from(branches)
      .where(eq(branches.tenantId, session.tenantId))
      .orderBy(branches.name);

    const [{ total }] = await tx
      .select({ total: count() })
      .from(users)
      .where(eq(users.tenantId, session.tenantId));
    const [{ active }] = await tx
      .select({ active: count() })
      .from(users)
      .where(
        and(eq(users.tenantId, session.tenantId), eq(users.status, "active"))
      );

    const registrations = await tx
      .select({
        id: legalRegistrations.id,
        authority: legalRegistrations.authority,
        authorityOther: legalRegistrations.authorityOther,
        registrationFor: legalRegistrations.registrationFor,
        registrationNumber: legalRegistrations.registrationNumber,
        expiryAt: legalRegistrations.expiryAt,
        status: legalRegistrations.status,
      })
      .from(legalRegistrations)
      .where(
        and(
          eq(legalRegistrations.tenantId, session.tenantId),
          sql`status IN ('active', 'pending_renewal')`
        )
      )
      .orderBy(legalRegistrations.authority);

    return {
      tenant,
      directors,
      branches: branchRows,
      employeeCounts: { total: Number(total), active: Number(active) },
      registrations,
    };
  });

  return (
    <div className="space-y-6 max-w-5xl print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Firm profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every regulator-facing data point about the firm in one place.
            Print this for SEBI inspection or DDQ submission.
          </p>
        </div>
        <PrintButton />
      </div>

      {/* Print-only title */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold text-center">
          {data.tenant.displayName} — Firm Profile
        </h1>
        <p className="text-center text-xs text-slate-500">
          Generated on {new Date().toLocaleDateString("en-GB")}
        </p>
        <hr className="my-3" />
      </div>

      {/* Inline editor + view — the editor handles the tenant scalar
          fields. Directors + branches + registrations have their own
          dedicated pages, surfaced here as read-only summaries. */}
      <FirmProfileEditor tenant={data.tenant as any} />

      {/* Directors */}
      <SectionCard
        title="Directors / Founders / Partners"
        subtitle={`${data.directors.length} on record`}
        actionHref="/dashboard/settings/firm-profile#directors"
      >
        {data.directors.length === 0 ? (
          <Empty msg="No directors / founders added yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">DIN</th>
                  <th className="px-3 py-2 text-left">PAN</th>
                  <th className="px-3 py-2 text-right">Share %</th>
                  <th className="px-3 py-2 text-left">Appointed</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.directors.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className="px-3 py-2 font-medium">
                      {d.name}
                      {d.email && (
                        <div className="text-[10px] text-muted-foreground">
                          {d.email}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 capitalize">
                      {d.role.replace(/_/g, " ")}
                    </td>
                    <td className="px-3 py-2 font-mono">{d.din ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">
                      {d.panNumber ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {d.shareholdingPct
                        ? `${Number(d.shareholdingPct).toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {d.dateOfAppointment ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`chip text-[10px] ${
                          d.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Branches */}
      <SectionCard
        title="Offices"
        subtitle={`${data.branches.length} on record · registered office is HQ`}
        actionHref="/dashboard/branches"
      >
        {data.branches.length === 0 ? (
          <Empty msg="No branches yet. The HQ is auto-created on signup." />
        ) : (
          <ul className="space-y-2">
            {data.branches.map((b) => (
              <li
                key={b.id}
                className="border border-slate-200 rounded-md p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">{b.name}</div>
                  {(b as any).isHq === "true" && (
                    <span className="chip bg-violet-50 text-violet-700 text-[10px]">
                      Registered HQ
                    </span>
                  )}
                </div>
                {(b as any).code && (
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {(b as any).code}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Registrations summary */}
      <SectionCard
        title="Licenses &amp; Registrations"
        subtitle={`${data.registrations.length} active / pending`}
        actionHref="/dashboard/legal-registrations"
      >
        {data.registrations.length === 0 ? (
          <Empty msg="No licenses on record. Add them in Legal Registrations." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Authority</th>
                  <th className="px-3 py-2 text-left">For</th>
                  <th className="px-3 py-2 text-left">Number</th>
                  <th className="px-3 py-2 text-left">Expiry</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.registrations.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 font-medium">
                      {r.authority === "Other"
                        ? r.authorityOther
                        : r.authority.replace("_", " ")}
                    </td>
                    <td className="px-3 py-2">{r.registrationFor}</td>
                    <td className="px-3 py-2 font-mono">
                      {r.registrationNumber ?? "—"}
                    </td>
                    <td className="px-3 py-2">{r.expiryAt ?? "Perpetual"}</td>
                    <td className="px-3 py-2 capitalize">
                      {r.status.replace("_", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* HR Summary */}
      <SectionCard
        title="Employees"
        subtitle="HR summary"
        actionHref="/dashboard/employees"
      >
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Total on record" value={data.employeeCounts.total} />
          <Stat label="Active" value={data.employeeCounts.active} />
        </div>
      </SectionCard>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  actionHref,
  children,
}: {
  title: string;
  subtitle?: string;
  actionHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-base">{title}</h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        {actionHref && (
          <a
            href={actionHref}
            className="text-xs text-violet-600 hover:underline print:hidden"
          >
            Manage →
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <p className="text-xs text-muted-foreground text-center py-6">{msg}</p>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
