/**
 * Firm P&L Statement (Network FP 8.3).
 *
 * Income = AMC commission payouts (amc_payouts) for the fiscal year.
 * Expenses = business_expenses grouped by category.
 * Net profit = net commission received − total expenses.
 *
 * Gated by reports.commission. FY via ?fy=YYYY-YY.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { PrintReportButton } from "@/components/investors/PrintReportButton";
import { currentFyLabel, fyStartYear, recentFyLabels } from "@/lib/finance/fiscal-year";

export const dynamic = "force-dynamic";

const CAT_LABEL: Record<string, string> = {
  office_rent: "Office Rent",
  team_salaries: "Team Salaries",
  team_welfare: "Team Welfare",
  utilities: "Utilities / Internet",
  travel: "Travel / Meetings",
  tech: "Tech / Software",
  knowledge: "Knowledge / Training",
  marketing: "Marketing",
  gst: "GST Paid",
  others: "Others",
};

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "reports.commission");
  const sp = await searchParams;
  const fy = sp.fy && /^\d{4}-\d{2}$/.test(sp.fy) ? sp.fy : currentFyLabel();
  const sy = fyStartYear(fy);
  const periodStart = `${sy}-04`; // 'YYYY-MM' lexicographic bounds
  const periodEnd = `${sy + 1}-03`;
  const dateStart = `${sy}-04-01`;
  const dateEnd = `${sy + 1}-03-31`;

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const [income, expenses] = await Promise.all([
        tx.execute(sql`
          SELECT
            COALESCE(SUM(gross_amount::numeric), 0)::numeric AS gross,
            COALESCE(SUM(tds_amount::numeric), 0)::numeric AS tds,
            COALESCE(SUM(net_amount::numeric), 0)::numeric AS net,
            COUNT(DISTINCT amc_code)::int AS amc_count
          FROM amc_payouts
          WHERE period >= ${periodStart} AND period <= ${periodEnd}
        `),
        tx.execute(sql`
          SELECT category, COALESCE(SUM(amount::numeric), 0)::numeric AS total
          FROM business_expenses
          WHERE expense_date >= ${dateStart}::date AND expense_date <= ${dateEnd}::date
          GROUP BY category
          ORDER BY total DESC
        `),
      ]);
      return { inc: income.rows[0] as any, exp: expenses.rows as any[] };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const grossIncome = Number(data.inc.gross);
  const tds = Number(data.inc.tds);
  const netIncome = Number(data.inc.net);
  const totalExpenses = data.exp.reduce((s, r) => s + Number(r.total), 0);
  const netProfit = netIncome - totalExpenses;
  const margin = netIncome > 0 ? (netProfit / netIncome) * 100 : null;
  const pct = (n: number) => (netIncome > 0 ? `${((n / netIncome) * 100).toFixed(1)}%` : "—");

  const fyOptions = recentFyLabels(4);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link href="/dashboard/finances" className="hover:underline inline-flex items-center gap-1">
              <ChevronLeft className="size-3" /> Finances
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">P&amp;L statement</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Income from AMC commissions minus business expenses — FY {fy}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5">
            {fyOptions.map((y) => (
              <Link
                key={y}
                href={`/dashboard/finances/pnl?fy=${y}`}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  y === fy ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                FY {y}
              </Link>
            ))}
          </div>
          <PrintReportButton />
        </div>
      </div>

      <div className="hidden print:block text-center mb-3">
        <h1 className="text-xl font-bold">P&amp;L Statement — FY {fy}</h1>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Net income" value={formatINR(netIncome)} tone="emerald" />
        <Card label="Total expenses" value={formatINR(totalExpenses)} tone="rose" />
        <Card label="Net profit" value={formatINR(netProfit)} tone={netProfit >= 0 ? "emerald" : "rose"} />
        <Card label="Net margin" value={margin != null ? `${margin.toFixed(1)}%` : "—"} tone="cyan" />
      </div>

      {/* Income */}
      <div className="card-surface overflow-hidden">
        <div className="border-b px-4 py-2.5 font-semibold text-sm">Income</div>
        <table className="w-full text-sm">
          <tbody>
            <Row label="Mutual fund distribution (gross commission)" value={grossIncome} pct={pct(grossIncome)} />
            <Row label="Less: TDS deducted" value={-tds} pct={pct(tds)} muted />
            <Row label="Net commission received" value={netIncome} bold />
          </tbody>
        </table>
        {grossIncome === 0 && (
          <div className="px-4 py-2 text-[11px] text-muted-foreground border-t">
            No commission payouts recorded for FY {fy}. Import a CAMS/KFin statement under{" "}
            <Link href="/dashboard/commission-reconciliation" className="text-brand-cyan-deep hover:underline">
              Commission Reconciliation
            </Link>
            .
          </div>
        )}
      </div>

      {/* Expenses */}
      <div className="card-surface overflow-hidden">
        <div className="border-b px-4 py-2.5 font-semibold text-sm flex items-center justify-between">
          <span>Expenses</span>
          <Link href={`/dashboard/finances/expenses?fy=${fy}`} className="text-xs text-brand-cyan-deep hover:underline font-medium print:hidden">
            Edit ledger →
          </Link>
        </div>
        {data.exp.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No expenses recorded for FY {fy}.
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {data.exp.map((r) => (
                <Row key={r.category} label={CAT_LABEL[r.category] ?? r.category} value={Number(r.total)} pct={pct(Number(r.total))} />
              ))}
              <Row label="Total expenditure" value={totalExpenses} bold />
            </tbody>
          </table>
        )}
      </div>

      {/* Net profit band */}
      <div className={`rounded-lg border p-4 flex items-center justify-between ${
        netProfit >= 0 ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"
      }`}>
        <span className="font-semibold text-sm">Net profit (FY {fy})</span>
        <span className={`text-xl font-bold tabular-nums ${netProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
          {formatINR(netProfit)}{margin != null ? ` · ${margin.toFixed(1)}% margin` : ""}
        </span>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  pct,
  bold,
  muted,
}: {
  label: string;
  value: number;
  pct?: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <tr className={`border-b last:border-0 ${bold ? "bg-secondary/30" : ""}`}>
      <td className={`px-4 py-2.5 ${bold ? "font-semibold" : muted ? "text-muted-foreground" : ""}`}>{label}</td>
      <td className={`py-2.5 text-right tabular-nums pr-4 ${bold ? "font-bold" : ""}`}>{formatINR(value)}</td>
      <td className="py-2.5 text-right tabular-nums text-xs text-muted-foreground pr-4 w-16">{pct ?? ""}</td>
    </tr>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "rose" | "cyan";
}) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-brand-cyan-deep";
  return (
    <div className="card-surface glass-card p-4">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
