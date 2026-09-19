import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { LineChart } from "lucide-react";
import { EquityDmatManager } from "@/components/equity/EquityDmatManager";

export const dynamic = "force-dynamic";

export default function EquityPage() {
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeaderCard title={<><LineChart className="size-5" /> Direct Equity — DMAT Accounts</>} subtitle={<>Your broking desk's DMAT accounts. New-DMAT and Active-Client counts in the Equity Team MIS come from
          these open / close dates.</>} />

      <EquityDmatManager />
    </div>
  );
}
