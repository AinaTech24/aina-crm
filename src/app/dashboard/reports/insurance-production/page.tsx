import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { InsuranceProductionBoard } from "@/components/reports/InsuranceProductionBoard";

export const dynamic = "force-dynamic";

export default function InsuranceProductionPage() {
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeaderCard title={<>Insurance Production — by Advisor</>} subtitle={<>Personal &amp; commercial-line premium booked in the FY, split New vs Renewal, per advisor.</>} />

      <InsuranceProductionBoard />
    </div>
  );
}
