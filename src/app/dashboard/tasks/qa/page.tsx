import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * QA queue (CEO review S7): the checks waiting for the viewer — Pass or Fail
 * each — and the results of the work the viewer can see. lib/qa/*.
 */

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { resolveDataAccess } from "@/lib/dashboards/team";
import { formatDate, humanise } from "@/lib/format";
import { InlineEmpty } from "@/components/common/EmptyState";
import { loadQaSettings, QA_FAIL_REASONS } from "@/lib/qa/sampling";
import { openChecksFor, recentFails, resultsByPerson } from "@/lib/qa/results";
import { buttonClass } from "@/components/ui/button-class";
import { QaVerdict } from "./QaVerdict";

export const dynamic = "force-dynamic";

export default async function QaQueuePage() {
  const session = await requireSession();
  await assertActiveLicense(session.tenantId, session.roles);
  const from = new Date(Date.now() - 90 * 86_400_000);

  const data = await withTenant(session.tenantId, async (tx) => {
    const access = await resolveDataAccess(tx, session);
    return {
      qa: await loadQaSettings(tx, session.tenantId),
      open: await openChecksFor(tx, session.tenantId, session.userId),
      people: await resultsByPerson(tx, session.tenantId, access, from),
      fails: await recentFails(tx, session.tenantId, access, from),
    };
  });
  const isAdmin = can(session.roles, "settings.dashboard", session.permissions);

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeaderCard
        title={<><ClipboardCheck className="size-6 text-muted-foreground" /> QA queue</>}
        breadcrumb={[{ label: "Tasks", href: "/dashboard/tasks" }, { label: "QA queue" }]}
        actions={isAdmin ? <Link href="/dashboard/settings/qa-sampling" className={buttonClass("secondary")}>QA settings</Link> : undefined}
      />
      {!data.qa.enabled && (
        <p className="dash-empty text-sm">
          QA sampling is off{isAdmin ? <> — switch it on in <Link href="/dashboard/settings/qa-sampling" className="underline">QA settings</Link></> : ""}.
        </p>
      )}

      <Section title={`To check${data.open.length ? ` · ${data.open.length}` : ""}`}>
        {data.open.length === 0 ? (
          <InlineEmpty message="No checks waiting for you." />
        ) : (
          <ul className="divide-y divide-border">
            {data.open.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <Link href={`/dashboard/tasks/${c.taskId}`} className="font-medium hover:underline">{c.taskTitle}</Link>
                  <div className="text-sm text-muted-foreground">
                    {[c.doerName, humanise(c.taskType), c.clientName, c.completedAt ? `done ${formatDate(c.completedAt)}` : null, c.dueAt ? `check by ${formatDate(c.dueAt)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <QaVerdict reviewId={c.id} reasons={[...QA_FAIL_REASONS]} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Results — last 90 days">
        {data.people.length === 0 ? (
          <InlineEmpty message="No checks decided yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Person</th>
                  <th className="text-right">Checked</th>
                  <th className="text-right">Passed</th>
                  <th className="text-right">Failed</th>
                  <th className="text-right">Pass rate</th>
                  <th className="text-right">Corrections open</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.doerId}>
                    <td>{p.doerName ?? "—"}</td>
                    <td className="text-right tabular-nums">{p.checked}</td>
                    <td className="text-right tabular-nums">{p.passed || "—"}</td>
                    <td className="text-right tabular-nums">{p.failed || "—"}</td>
                    <td className="text-right tabular-nums font-medium">{Math.round((p.passed / p.checked) * 100)}%</td>
                    <td className={`text-right tabular-nums ${p.openCorrections ? "text-warning font-medium" : ""}`}>{p.openCorrections || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {data.fails.length > 0 && (
        <Section title="Recent fails">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Task</th>
                  <th className="text-left">Person</th>
                  <th className="text-left">Reason</th>
                  <th className="text-left">When</th>
                  <th className="text-left">Correction</th>
                </tr>
              </thead>
              <tbody>
                {data.fails.map((f) => (
                  <tr key={`${f.taskId}:${f.at}`}>
                    <td className="max-w-xs">
                      <Link href={`/dashboard/tasks/${f.taskId}`} className="hover:underline">{f.taskTitle}</Link>
                      {f.note && <div className="text-2xs text-muted-foreground line-clamp-2">{f.note}</div>}
                    </td>
                    <td>{f.doerName ?? "—"}</td>
                    <td>{f.reason ?? "—"}</td>
                    <td className="whitespace-nowrap">{formatDate(f.at)}</td>
                    <td>
                      {f.correctionId ? (
                        <Link href={`/dashboard/tasks/${f.correctionId}`} className="hover:underline">{humanise(f.correctionStatus ?? "open")}</Link>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-surface p-5">
      <h2 className="section-title">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}
