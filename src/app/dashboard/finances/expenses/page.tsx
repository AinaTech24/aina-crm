/**
 * Expense Ledger (Network FP 8.2) — firm expense bookkeeping.
 * Gated by reports.commission. FY selectable via ?fy=YYYY-YY.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { businessExpenses } from "@/db/schema";
import { currentFyLabel, fyBounds, recentFyLabels } from "@/lib/finance/fiscal-year";
import { ExpenseLedger } from "@/components/finances/ExpenseLedger";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "reports.commission");
  const sp = await searchParams;
  const fy = sp.fy && /^\d{4}-\d{2}$/.test(sp.fy) ? sp.fy : currentFyLabel();
  const bounds = fyBounds(fy);

  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx
      .select()
      .from(businessExpenses)
      .where(
        and(
          eq(businessExpenses.tenantId, session.tenantId),
          gte(businessExpenses.expenseDate, bounds.startISO),
          lte(businessExpenses.expenseDate, bounds.endISO)
        )
      )
      .orderBy(desc(businessExpenses.expenseDate), desc(businessExpenses.createdAt))
      .limit(1000);
  });

  const serialised = rows.map((r) => ({
    id: r.id,
    expenseDate: String(r.expenseDate),
    description: r.description,
    category: r.category,
    paidFrom: r.paidFrom,
    amount: String(r.amount),
    notes: r.notes ?? null,
  }));

  const fyOptions = recentFyLabels(4);

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Link href="/dashboard/finances" className="hover:underline inline-flex items-center gap-1">
            <ChevronLeft className="size-3" /> Finances
          </Link>
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Expense ledger</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Record and categorise every business expense. Feeds the firm P&amp;L.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5">
            {fyOptions.map((y) => (
              <Link
                key={y}
                href={`/dashboard/finances/expenses?fy=${y}`}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  y === fy ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                FY {y}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <ExpenseLedger fy={fy} initial={serialised} />
    </div>
  );
}
