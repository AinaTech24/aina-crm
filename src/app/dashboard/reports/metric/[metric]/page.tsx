import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { notFound } from "next/navigation";
import { MetricStatusBoard } from "@/components/reports/MetricStatusBoard";
import { metricBySlug } from "@/lib/finance/metric-config";

export const dynamic = "force-dynamic";

export default async function MetricStatusPage({
  params,
}: {
  params: Promise<{ metric: string }>;
}) {
  const { metric: slug } = await params;
  const meta = metricBySlug(slug);
  if (!meta) notFound();

  return (
    <div className="space-y-5 max-w-6xl">
      <PageHeaderCard title={<>{meta.title} — Branch-wise</>} />

      <MetricStatusBoard metricKey={meta.key} />
    </div>
  );
}
