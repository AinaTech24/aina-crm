/**
 * Finances hub (Network FP Module 8) — the MFD's own business finances.
 * Links the expense ledger, P&L, monthly progress, projections and the
 * finance checklist. Gated by reports.commission.
 */

import Link from "next/link";
import {
  Wallet,
  Receipt,
  Scale,
  Target,
  TrendingUp,
  CheckSquare,
  ArrowRight,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const CARDS = [
  {
    href: "/dashboard/finances/expenses",
    icon: Receipt,
    title: "Expense ledger",
    desc: "Record and categorise every business expense, month by month.",
  },
  {
    href: "/dashboard/finances/pnl",
    icon: Scale,
    title: "P&L statement",
    desc: "Commission income minus expenses → net profit, by fiscal year.",
  },
  {
    href: "/dashboard/finances/progress",
    icon: Target,
    title: "Monthly progress",
    desc: "Annual targets vs live actuals — clients, AUM, SIP, lumpsum.",
  },
  {
    href: "/dashboard/reports/business-projections",
    icon: TrendingUp,
    title: "Business projections",
    desc: "Project AUM & commission income over the next 10 years.",
  },
  {
    href: "/dashboard/reports/financial-checklist",
    icon: CheckSquare,
    title: "Finance checklist",
    desc: "Daily → annual bookkeeping, tax & compliance cadence.",
  },
];

export default async function FinancesHubPage() {
  const session = await requireSession();
  requireCap(session.roles, "reports.commission");

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Wallet className="size-6 text-brand-cyan" /> Practice finances
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Your firm's own books — income, expenses, profitability, targets and growth planning.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.href}
              href={c.href}
              className="card-surface glass-card p-5 hover-lift group flex flex-col"
            >
              <div className="size-9 rounded-lg bg-brand-cyan-light grid place-items-center mb-3">
                <Icon className="size-4.5 text-brand-cyan-deep" />
              </div>
              <div className="font-semibold text-sm flex items-center gap-1">
                {c.title}
                <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{c.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
