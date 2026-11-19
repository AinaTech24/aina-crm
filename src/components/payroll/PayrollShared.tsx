/**
 * Shared, server-safe pieces of the Payroll pages: the tabs, the full-rupee
 * formatter (a payslip shows ₹28,000, never "₹0.28 L") and the payslip.
 */

import Link from "next/link";
import type { PayResult } from "@/lib/payroll/calc";
import { stateName } from "@/lib/payroll/statutory";

export const rupees = (n: number | string | null | undefined) =>
  n == null || n === "" ? "—" : `₹${Math.round(Number(n)).toLocaleString("en-IN")}`;

export const monthLabel = (period: string) =>
  new Date(`${period.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export type PayrollTab = "runs" | "employees" | "loans" | "claims" | "incentives" | "declarations" | "settings";

export function PayrollTabs({ active }: { active: PayrollTab }) {
  const tabs: Array<{ key: PayrollTab; href: string; label: string }> = [
    { key: "runs", href: "/dashboard/payroll", label: "Pay runs" },
    { key: "employees", href: "/dashboard/payroll/employees", label: "Employees" },
    { key: "loans", href: "/dashboard/payroll/loans", label: "Loans" },
    { key: "claims", href: "/dashboard/payroll/claims", label: "Claims" },
    { key: "incentives", href: "/dashboard/payroll/incentives", label: "Incentives" },
    { key: "declarations", href: "/dashboard/payroll/declarations", label: "Tax declarations" },
    { key: "settings", href: "/dashboard/payroll/settings", label: "Settings" },
  ];
  return (
    <nav aria-label="Payroll" className="flex max-w-full overflow-x-auto rounded-lg border border-border bg-card p-0.5 gap-0.5 w-fit">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium ${active === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** My pay: payslips, the tax declaration and expense claims. */
export function MyPayTabs({ active }: { active: "payslips" | "tax" | "claims" }) {
  const tabs = [
    { key: "payslips", href: "/dashboard/my-pay", label: "Payslips" },
    { key: "tax", href: "/dashboard/my-pay/tax", label: "Tax declaration" },
    { key: "claims", href: "/dashboard/my-pay/claims", label: "Expense claims" },
  ] as const;
  return (
    <nav aria-label="My pay" className="dash-seg w-fit">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={active === t.key ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

type EmployeeMeta ={ name: string; employeeCode?: string | null; department?: string | null; workState?: string | null };

/** The payslip — the frozen calculation of one person's month, every line with its reason. */
export function Payslip({
  firm,
  period,
  employee,
  result,
  showWhy = true,
}: {
  firm: string;
  period: string;
  employee: EmployeeMeta;
  result: PayResult;
  showWhy?: boolean;
}) {
  const Rows = ({ lines }: { lines: PayResult["earnings"] }) => (
    <tbody>
      {lines.map((l, i) => (
        <tr key={`${l.code}-${i}`} className="align-top">
          <td className="py-1.5 pr-3">
            <div>{l.label}</div>
            {showWhy && <div className="text-2xs text-muted-foreground">{l.why}</div>}
          </td>
          <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{rupees(l.amount)}</td>
        </tr>
      ))}
    </tbody>
  );
  return (
    <article className="card-surface rounded-xl border p-6 sm:p-8 space-y-6 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="text-lg font-bold">{firm}</div>
          <div className="text-sm text-muted-foreground">Payslip for {monthLabel(period)}</div>
        </div>
        <div className="text-sm text-right">
          <div className="font-semibold">{employee.name}</div>
          <div className="text-muted-foreground">
            {[employee.employeeCode, employee.department, employee.workState ? stateName(employee.workState) : null].filter(Boolean).join(" · ")}
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-lg bg-secondary/60 p-3"><div className="text-muted-foreground">Paid days</div><div className="font-semibold tabular-nums">{result.payableDays} of {result.baseDays}</div></div>
        <div className="rounded-lg bg-secondary/60 p-3"><div className="text-muted-foreground">Days without pay</div><div className="font-semibold tabular-nums">{result.lopDays}</div></div>
        <div className="rounded-lg bg-secondary/60 p-3"><div className="text-muted-foreground">Net pay</div><div className="font-semibold tabular-nums">{rupees(result.net)}</div></div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold mb-2">Earnings</h3>
          <table className="table-raw w-full text-sm">
            <Rows lines={result.earnings} />
            <tfoot><tr className="border-t border-border font-semibold"><td className="py-2">Gross pay</td><td className="py-2 text-right tabular-nums">{rupees(result.gross)}</td></tr></tfoot>
          </table>
        </section>
        <section>
          <h3 className="text-sm font-semibold mb-2">Deductions</h3>
          <table className="table-raw w-full text-sm">
            <Rows lines={result.deductions} />
            <tfoot><tr className="border-t border-border font-semibold"><td className="py-2">Total deductions</td><td className="py-2 text-right tabular-nums">{rupees(result.totalDeductions)}</td></tr></tfoot>
          </table>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-4">
        <span className="font-semibold">Net pay</span>
        <span className="text-xl font-bold tabular-nums">{rupees(result.net)}</span>
      </div>

      {result.employer.length > 0 && (
        <section className="text-sm">
          <h3 className="font-semibold mb-2">Paid by the firm on top of your salary</h3>
          <table className="table-raw w-full text-sm"><Rows lines={result.employer} /></table>
        </section>
      )}
    </article>
  );
}
