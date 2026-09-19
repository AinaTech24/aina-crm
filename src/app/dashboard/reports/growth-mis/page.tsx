import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { GrowthMisBoard } from "@/components/reports/GrowthMisBoard";

export const dynamic = "force-dynamic";

export default function GrowthMisPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeaderCard title={<>Growth MIS</>} subtitle={<>One screen tying efforts to results — the monthly review at a glance.</>} />

      <GrowthMisBoard />
    </div>
  );
}
