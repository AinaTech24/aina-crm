import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { NetSalesBoard } from "@/components/reports/NetSalesBoard";

export const dynamic = "force-dynamic";

export default function NetSalesPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<>Net Sales — by Platform</>} subtitle={<>Gross sales, redemption and net sales by execution platform, per product vertical.</>} />

      <NetSalesBoard />
    </div>
  );
}
