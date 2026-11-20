import Link from "next/link";
import { LineChart } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EquityDmatManager } from "@/components/equity/EquityDmatManager";
import { EquityBrokerageDesk } from "@/components/equity/EquityBrokerageDesk";
import { requireSession } from "@/lib/auth/session";
import { equityDeskEnabled, mayUseEquityDesk } from "@/lib/equity/access";

export const dynamic = "force-dynamic";

/**
 * Direct Equity. A firm with the Equity desk (We Care, 2026-11-20) gets two
 * tabs — daily brokerage and DMAT accounts; every other firm keeps the DMAT
 * register as it was.
 */
export default async function EquityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession();
  const desk = (await equityDeskEnabled(session)) && mayUseEquityDesk(session);

  if (!desk) {
    return (
      <div className="space-y-5 max-w-4xl">
        <PageHeaderCard title={<><LineChart className="size-5" /> Direct Equity — DMAT Accounts</>} />

        <EquityDmatManager />
      </div>
    );
  }

  const tab = (await searchParams).tab === "dmat" ? "dmat" : "brokerage";
  const tabs = [
    { key: "brokerage", label: "Daily brokerage" },
    { key: "dmat", label: "DMAT accounts" },
  ];
  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeaderCard title={<><LineChart className="size-5" /> Equity desk</>} />
      <nav className="dash-seg w-fit" aria-label="Equity desk">
        {tabs.map((t) => (
          <Link key={t.key} href={`/dashboard/equity?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "brokerage" ? <EquityBrokerageDesk /> : <EquityDmatManager enhanced />}
    </div>
  );
}
