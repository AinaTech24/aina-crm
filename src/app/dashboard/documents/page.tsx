import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { FolderArchive, Upload, AlertTriangle } from "lucide-react";
import { withTenant } from "@/db/client";
import { complianceDocuments } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  arn: "bg-purple-50 text-purple-700",
  euin: "bg-purple-50 text-purple-700",
  nism: "bg-purple-50 text-purple-700",
  kyd: "bg-indigo-50 text-indigo-700",
  amc_empanelment: "bg-blue-50 text-blue-700",
  ddq: "bg-emerald-50 text-emerald-700",
  sop: "bg-amber-50 text-amber-700",
  marketing_approval: "bg-pink-50 text-pink-700",
  complaint: "bg-rose-50 text-rose-700",
  audit_report: "bg-orange-50 text-orange-700",
  ria_compliance: "bg-teal-50 text-teal-700",
  other: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE expires_on IS NOT NULL
          AND expires_on <= current_date + interval '30 days'
          AND expires_on >= current_date)::int AS expiring_soon,
        COUNT(*) FILTER (WHERE expires_on IS NOT NULL
          AND expires_on < current_date)::int AS expired
      FROM compliance_documents
    `);
    const s = stats.rows[0] as any;
    const rows = await tx.select().from(complianceDocuments).orderBy(desc(complianceDocuments.createdAt)).limit(100);
    return {
      total: Number(s.total),
      expiringSoon: Number(s.expiring_soon),
      expired: Number(s.expired),
      rows,
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground text-sm">
            Encrypted vault — KYC, mandates, AMC empanelment, DDQ, SOPs, complaints.
          </p>
        </div>
        <Link
          href="/dashboard/documents/upload"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
        >
          <Upload className="size-4" /> Upload document
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total documents" value={data.total} />
        <Stat label="Expiring (30d)" value={data.expiringSoon} tone={data.expiringSoon > 0 ? "amber" : "muted"} />
        <Stat label="Expired" value={data.expired} tone={data.expired > 0 ? "rose" : "muted"} />
      </div>

      <div className="border rounded-lg bg-card">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <FolderArchive className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No documents uploaded yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Upload ARN/EUIN/NISM certificates, AMC empanelment, KYD docs, SOPs, and per-client
              KYC + mandate scans. All stored encrypted in S3 (ap-south-1).
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-left py-2 font-medium">Issued</th>
                <th className="text-left py-2 font-medium">Expires</th>
                <th className="text-left py-2 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((d) => {
                const exp = d.expiresOn ? new Date(d.expiresOn) : null;
                const expired = exp && exp.getTime() < Date.now();
                const expiringSoon = exp && !expired && exp.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
                return (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <div className="font-medium">{d.name}</div>
                      {d.description && <div className="text-xs text-muted-foreground line-clamp-1">{d.description}</div>}
                    </td>
                    <td className="py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.other}`}>
                        {d.category}
                      </span>
                    </td>
                    <td className="py-3 text-xs">{d.issuedOn ? formatDate(d.issuedOn) : "—"}</td>
                    <td className="py-3 text-xs">
                      {exp ? (
                        <span className={expired ? "text-rose-600 font-medium" : expiringSoon ? "text-amber-600" : ""}>
                          {(expired || expiringSoon) && <AlertTriangle className="size-3 inline mr-1" />}
                          {formatDate(exp)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">{formatRelative(d.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "rose" | "amber" | "muted" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
