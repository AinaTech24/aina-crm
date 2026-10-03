import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { notFound } from "next/navigation";
import { BranchRmMatrix } from "@/components/reports/BranchRmMatrix";
import { rmMatrixBySlug } from "@/lib/business/rm-matrix-config";

export const dynamic = "force-dynamic";

export default async function BranchRmPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind: slug } = await params;
  const meta = rmMatrixBySlug(slug);
  if (!meta) notFound();

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeaderCard title={<>{meta.title} — Branch &amp; RM-wise</>} />

      <BranchRmMatrix kind={meta.key} />
    </div>
  );
}
