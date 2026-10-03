import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { RedemptionReportBoard } from "@/components/reports/RedemptionReportBoard";

export const dynamic = "force-dynamic";

export default function RedemptionReportPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<>Redemption by Client</>} />

      <RedemptionReportBoard />
    </div>
  );
}
