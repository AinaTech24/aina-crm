import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { withTenant } from "@/db/client";
import { privacyRequests } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatDate } from "@/lib/format";
import { erasureVerdict } from "@/lib/privacy/requests";
import { REQUEST_CHANNELS, REQUEST_TYPES, daysLeft, type RequestChannel, type RequestType } from "@/lib/privacy/requests-core";
import { RequestActions } from "./RequestActions";

export const dynamic = "force-dynamic";

/** One privacy request: who asked, for what, by when, and what was done. */
export default async function PrivacyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!can(session.roles, "compliance.view", session.permissions)) {
    return (
      <div className="mt-6">
        <EmptyState icon={ShieldCheck} title="Privacy requests are handled by the compliance officer" description="Ask the firm owner if you need access." primary={{ href: "/dashboard", label: "Back to dashboard" }} />
      </div>
    );
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await withTenant(session.tenantId, async (tx) => {
    const [r] = await tx.select().from(privacyRequests).where(and(eq(privacyRequests.tenantId, session.tenantId), eq(privacyRequests.id, id)));
    if (!r) return null;
    const people = await tx.execute(sql`
      SELECT
        (SELECT name FROM users WHERE id = ${r.assigneeId}::uuid) AS assignee,
        (SELECT name FROM users WHERE id = ${r.identityVerifiedBy}::uuid) AS verifier,
        (SELECT name FROM users WHERE id = ${r.closedBy}::uuid) AS closer,
        CASE ${r.subjectType}
          WHEN 'investor' THEN (SELECT name FROM investors WHERE id = ${r.subjectId}::uuid AND tenant_id = ${session.tenantId}::uuid)
          WHEN 'lead' THEN (SELECT name FROM leads WHERE id = ${r.subjectId}::uuid AND tenant_id = ${session.tenantId}::uuid)
        END AS subject_name`);
    const p = people.rows[0] as { assignee: string | null; verifier: string | null; closer: string | null; subject_name: string | null };
    const subject = r.subjectType && r.subjectId ? { type: r.subjectType as "investor" | "lead", id: r.subjectId } : null;
    const verdict =
      r.type === "erasure" && r.status === "open" && subject && p.subject_name && r.erasureResult !== "erased"
        ? await erasureVerdict(tx, session.tenantId, subject)
        : null;
    return { r, p, subject, verdict };
  });
  if (!data) notFound();
  const { r, p, subject, verdict } = data;

  const left = daysLeft(r.dueAt);
  const open = r.status === "open";
  const subjectHref = subject && p.subject_name
    ? subject.type === "investor" ? `/dashboard/investors/${subject.id}` : `/dashboard/leads/${subject.id}`
    : null;
  const rows: Array<[string, React.ReactNode]> = [
    ["Requested by", r.requesterName],
    ["Email", r.requesterEmail],
    ["Phone", r.requesterPhone],
    [
      "Record",
      subjectHref ? (
        <Link href={subjectHref} className="text-primary hover:underline">{p.subject_name} ({subject!.type === "investor" ? "client" : "lead"})</Link>
      ) : subject ? (
        "Erased"
      ) : (
        "Not on the CRM"
      ),
    ],
    ["Request", REQUEST_TYPES[r.type as RequestType] ?? r.type],
    ["Came in by", REQUEST_CHANNELS[r.channel as RequestChannel] ?? r.channel],
    ["Received", formatDate(r.receivedAt)],
    ["Answer by", formatDate(r.dueAt)],
    ["Handled by", p.assignee],
    ["Identity checked", r.identityVerifiedAt ? `${formatDate(r.identityVerifiedAt)}${p.verifier ? ` by ${p.verifier}` : ""}` : "Not yet"],
    ["Details", r.details],
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeaderCard
        title={`Privacy request ${r.reference}`}
        breadcrumb={[{ label: "Privacy requests", href: "/dashboard/privacy-requests" }, { label: r.reference }]}
        actions={
          open ? (
            <Badge tone={left < 0 ? "danger" : left <= 15 ? "warning" : "neutral"}>
              {left < 0 ? `${-left} days overdue` : left === 0 ? "Due today" : `${left} days left`}
            </Badge>
          ) : (
            <Badge tone={r.status === "completed" ? "success" : "neutral"}>{r.status === "completed" ? "Answered" : "Refused"}</Badge>
          )
        }
      />

      <Card>
        <CardHeader title="The request" />
        <dl className="grid gap-x-6 gap-y-3 px-5 pb-5 sm:grid-cols-[10rem_1fr] text-sm">
          {rows
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="whitespace-pre-wrap break-words">{v}</dd>
              </div>
            ))}
        </dl>
      </Card>

      {!open && (
        <Card>
          <CardHeader title="Outcome" />
          <div className="px-5 pb-5 text-sm space-y-2">
            <p className="whitespace-pre-wrap">{r.outcome}</p>
            {r.erasureResult && (
              <p className="text-muted-foreground">
                {r.erasureResult === "erased" ? "The person's data was erased." : `Records kept until ${formatDate(r.erasureResult.replace("retained_until:", ""))} under the Prevention of Money Laundering Act; marketing stopped.`}
              </p>
            )}
            <p className="text-muted-foreground">Closed {r.closedAt ? formatDate(r.closedAt) : ""}{p.closer ? ` by ${p.closer}` : ""}</p>
          </div>
        </Card>
      )}

      {open && (
        <RequestActions
          id={r.id}
          type={r.type}
          canEdit={can(session.roles, "compliance.edit", session.permissions)}
          verified={!!r.identityVerifiedAt}
          hasSubject={!!subjectHref}
          erasureResult={r.erasureResult}
          verdict={
            verdict
              ? verdict.kind === "retain"
                ? { kind: "retain", reason: verdict.reason }
                : verdict.kind === "blocked"
                  ? { kind: "blocked", reason: verdict.reason }
                  : { kind: "erase" }
              : null
          }
        />
      )}
    </div>
  );
}
