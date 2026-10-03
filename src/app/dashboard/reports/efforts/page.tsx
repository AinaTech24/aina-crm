import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EffortsBoard } from "@/components/reports/EffortsBoard";

export const dynamic = "force-dynamic";

export default function EffortsPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<>Efforts — Plan vs Actual</>} />

      <EffortsBoard />
    </div>
  );
}
