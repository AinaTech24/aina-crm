import { and, eq } from "drizzle-orm";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { MyPayTabs } from "@/components/payroll/PayrollShared";
import { withTenant } from "@/db/client";
import { taxDeclarations } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { employeesForMonth, fyStart, loadPayrollSettings, ytdForMonth } from "@/lib/payroll/run";
import { readDeclaration, readProofs } from "@/lib/payroll/tax";
import { TaxForm } from "./TaxForm";

export const dynamic = "force-dynamic";

/** My pay → Tax declaration: choose the regime, declare, and (from January) prove. */
export default async function MyTaxPage() {
  const session = await requireSession();
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const period = `${today.slice(0, 7)}-01`;
  const fy = fyStart(period);
  const data = await withTenant(session.tenantId, async (tx) => {
    const settings = await loadPayrollSettings(tx, session.tenantId);
    const me = (await employeesForMonth(tx, session.tenantId, period, settings)).find((e) => e.userId === session.userId) ?? null;
    const ytd = (await ytdForMonth(tx, session.tenantId, period)).get(session.userId) ?? { taxableGross: 0, tds: 0 };
    const [decl] = await tx
      .select()
      .from(taxDeclarations)
      .where(and(eq(taxDeclarations.tenantId, session.tenantId), eq(taxDeclarations.userId, session.userId), eq(taxDeclarations.fyStart, fy)));
    return { settings, me, ytd, decl };
  });
  const fyLabel = `${fy.slice(0, 4)}-${String((Number(fy.slice(0, 4)) + 1) % 100).padStart(2, "0")}`;
  const deadline = new Date(Date.UTC(Number(fy.slice(0, 4)) + 1, data.settings.proofDeadlineMonth, 0)).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeaderCard title="My pay" />
      <MyPayTabs active="tax" />
      <TaxForm
        fyLabel={fyLabel}
        proofDeadline={deadline}
        period={period}
        settings={data.settings}
        employee={
          data.me?.monthlyGross != null
            ? {
                monthlyGross: data.me.monthlyGross,
                basicOverride: data.me.basicOverride,
                hraOverride: data.me.hraOverride,
                pfEnabled: data.me.pfEnabled,
                esiMode: data.me.esiMode,
                workState: data.me.workState,
                gender: data.me.gender,
                joinDate: data.me.joinDate,
                exitDate: data.me.exitDate,
              }
            : null
        }
        ytd={data.ytd}
        initial={{
          regime: data.decl?.regime === "old" ? "old" : data.me?.taxRegime ?? "new",
          declared: readDeclaration(data.decl?.declared),
          proofs: readProofs(data.decl?.proofs),
          submitted: !!data.decl?.submittedAt,
        }}
      />
    </div>
  );
}
