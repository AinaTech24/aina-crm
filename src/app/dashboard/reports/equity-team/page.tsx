import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EquityTeamBoard } from "@/components/reports/EquityTeamBoard";

export const dynamic = "force-dynamic";

export default function EquityTeamPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeaderCard title={<>Equity Team — Planned vs Actual</>} subtitle={<>Direct-equity desk: Brokerage, New DMAT and Active Clients — FY plan, achievement and month-on-month.</>} />

      <EquityTeamBoard />
    </div>
  );
}
