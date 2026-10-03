import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { SifStatusBoard } from "@/components/reports/SifStatusBoard";

export const dynamic = "force-dynamic";

export default function SifStatusPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeaderCard title={<>SIF Business — Target vs Actual</>} />

      <SifStatusBoard />
    </div>
  );
}
