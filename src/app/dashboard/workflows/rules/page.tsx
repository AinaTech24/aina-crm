import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Plus, Workflow, Lock } from "lucide-react";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { MODULES, type ModuleKey } from "@/lib/workflow-rules/modules";
import { RuleToggle } from "@/components/workflow-rules/RuleToggle";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TRIGGER_LABEL: Record<string, string> = {
  record_action: "Record action",
  date_field: "Date field",
  score_change: "Score change",
  note: "Note",
  recommendation: "Recommendation",
  competitor: "Competitor",
  recurrence: "Recurring",
};

export default async function WorkflowRulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const moduleFilter = sp.module ?? "";

  const rules = await withTenant(session.tenantId, async (tx) => {
    const all = await tx.select().from(workflowRules).where(eq(workflowRules.tenantId, session.tenantId)).orderBy(workflowRules.module, workflowRules.executionOrder, desc(workflowRules.createdAt));
    return moduleFilter ? all.filter((r) => r.module === moduleFilter) : all;
  });

  // Group by module
  const byModule = new Map<ModuleKey, typeof rules>();
  for (const r of rules) {
    const arr = byModule.get(r.module as ModuleKey) ?? [];
    arr.push(r);
    byModule.set(r.module as ModuleKey, arr);
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <Workflow className="size-6 text-brand-cyan" /> Workflow Rules
          </h1>
          <p className="page-subtitle">
            Zoho-style automation rules · trigger → criteria → instant + scheduled actions.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/workflows/rules/new" className="btn-primary">
            <Plus className="size-4" /> Create Rule
          </Link>
        </div>
      </div>

      {/* Module filter strip */}
      <div className="flex flex-wrap gap-1.5">
        <Link
          href="/dashboard/workflows/rules"
          className={`chip text-[11px] ${!moduleFilter ? "bg-brand-cyan text-white" : "bg-secondary text-foreground"}`}
        >
          All modules · {rules.length}
        </Link>
        {Object.values(MODULES).map((mod) => {
          const count = (rules as any).filter((r: any) => r.module === mod.key).length;
          if (count === 0 && moduleFilter !== mod.key) return null;
          return (
            <Link
              key={mod.key}
              href={`/dashboard/workflows/rules?module=${mod.key}`}
              className={`chip text-[11px] ${
                moduleFilter === mod.key
                  ? "bg-brand-cyan text-white"
                  : "bg-secondary text-foreground hover:bg-brand-cyan-light"
              }`}
            >
              {mod.label} · {count}
            </Link>
          );
        })}
      </div>

      {/* Rules grouped by module */}
      {byModule.size === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          <Workflow className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2 font-medium">No workflow rules yet.</div>
          <p className="mt-2 text-xs max-w-md mx-auto">
            Click <strong>Create Rule</strong> to set up your first automation — e.g., "When a lead
            stage becomes <em>proposal_shared</em>, send a WhatsApp follow-up after 3 days."
          </p>
        </div>
      ) : (
        [...byModule.entries()].map(([moduleKey, items]) => {
          const mod = MODULES[moduleKey];
          return (
            <section key={moduleKey} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {mod?.label ?? moduleKey} · {items.length} rule{items.length === 1 ? "" : "s"}
                </h2>
              </div>
              <div className="card-surface overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Rule</th>
                      <th className="text-left py-2 font-medium">Trigger</th>
                      <th className="text-left py-2 font-medium">Criteria</th>
                      <th className="text-center py-2 font-medium">Instant</th>
                      <th className="text-center py-2 font-medium">Scheduled</th>
                      <th className="text-center py-2 font-medium">Executions</th>
                      <th className="text-center py-2 font-medium">Active</th>
                      <th className="text-right py-2 font-medium pr-4">Last run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => {
                      const triggerLabel = TRIGGER_LABEL[r.triggerType] ?? r.triggerType;
                      const sub =
                        r.triggerType === "record_action"
                          ? String((r.triggerConfig as any)?.when ?? "")
                          : r.triggerType === "date_field"
                            ? `${(r.triggerConfig as any)?.when ?? ""} ${(r.triggerConfig as any)?.offset ?? 0} ${(r.triggerConfig as any)?.unit ?? "day"}(s)`
                            : "";
                      return (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {r.locked && <Lock className="size-3 text-amber-600" />}
                              <Link href={`/dashboard/workflows/rules/${r.id}`} className="font-medium hover:underline">
                                {r.name}
                              </Link>
                            </div>
                            {r.description && (
                              <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                                {r.description}
                              </div>
                            )}
                          </td>
                          <td className="py-3 text-xs">
                            <div className="font-medium">{triggerLabel}</div>
                            <div className="text-muted-foreground capitalize">{sub.replace(/_/g, " ")}</div>
                          </td>
                          <td className="py-3 text-xs text-muted-foreground">
                            {((r.criteriaRows ?? []) as any[]).length === 0 ? (
                              <span className="italic">all records</span>
                            ) : (
                              <span>{((r.criteriaRows ?? []) as any[]).length} condition(s)</span>
                            )}
                          </td>
                          <td className="py-3 text-center tabular-nums">
                            {((r.instantActions ?? []) as any[]).length}
                          </td>
                          <td className="py-3 text-center tabular-nums">
                            {((r.scheduledActions ?? []) as any[]).length}
                          </td>
                          <td className="py-3 text-center tabular-nums text-muted-foreground">
                            {r.executionCount ?? 0}
                          </td>
                          <td className="py-3 text-center">
                            <RuleToggle id={r.id} enabled={r.enabled} locked={r.locked} />
                          </td>
                          <td className="py-3 text-right pr-4 text-[11px] text-muted-foreground">
                            {r.lastExecutedAt ? formatRelative(r.lastExecutedAt) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
