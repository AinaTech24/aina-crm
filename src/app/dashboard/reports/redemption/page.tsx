import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { RedemptionReportBoard } from "@/components/reports/RedemptionReportBoard";

export const dynamic = "force-dynamic";

export default function RedemptionReportPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<>Redemption by Client</>} subtitle={<>Every client's redemptions this month, grouped by contact owner → desk → branch.</>} />

      <RedemptionReportBoard />
    </div>
  );
}
