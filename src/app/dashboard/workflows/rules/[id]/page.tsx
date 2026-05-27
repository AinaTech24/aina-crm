import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { ChevronLeft, Lock, Workflow, Sparkles, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { workflowRules, workflowRuleExecutions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { MODULES } from "@/lib/workflow-rules/modules";
import { RuleToggle } from "@/components/workflow-rules/RuleToggle";
import { LockButton } from "@/components/workflow-rules/LockButton";
import { DeleteRuleButton } from "@/components/workflow-rules/DeleteRuleButton";
import { formatDate, formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  send_email: "Email Notification",
  send_whatsapp: "WhatsApp Message",
  send_sms: "SMS Message",
  create_task: "Task",
  schedule_meeting: "Meeting",
  schedule_call: "Call",
  update_field: "Field Update",
  add_tag: "Add Tag",
  remove_tag: "Remove Tag",
  webhook: "Webhook",
  custom_function: "Custom Function",
  create_record: "Create Record",
  convert_lead: "Convert Lead",
  create_notification: "In-app Notification",
};

export default async function RuleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [rule] = await tx.select().from(workflowRules).where(eq(workflowRules.id, id));
    if (!rule) return null;
    const execs = await tx
      .select()
      .from(workflowRuleExecutions)
      .where(eq(workflowRuleExecutions.ruleId, id))
      .orderBy(desc(workflowRuleExecutions.executedAt))
      .limit(50);
    return { rule, execs };
  });
  if (!data) notFound();

  const { rule, execs } = data;
  const mod = MODULES[rule.module as keyof typeof MODULES];
  const cfg = (rule.triggerConfig ?? {}) as any;
  const instant = (rule.instantActions ?? []) as any[];
  const scheduled = (rule.scheduledActions ?? []) as any[];
  const criteria = (rule.criteriaRows ?? []) as any[];

  // Usage stats
  const total = execs.length;
  const succeeded = execs.filter((e) => e.status === "succeeded").length;
  const failed = execs.filter((e) => e.status === "failed").length;
  const partial = execs.filter((e) => e.status === "partial").length;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <Link href="/dashboard/workflows/rules" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ChevronLeft className="size-3" /> Back to rules
        </Link>
        <div className="flex items-center justify-between mt-2 flex-wrap gap-3">
          <div>
            <h1 className="page-title">
              {rule.locked && <Lock className="size-5 text-amber-600" />}
              <Workflow className="size-6 text-brand-cyan" /> {rule.name}
            </h1>
            <p className="page-subtitle">
              Module: <strong>{mod?.label ?? rule.module}</strong> · {rule.executionCount ?? 0} executions
              {rule.lastExecutedAt && <> · last run {formatRelative(rule.lastExecutedAt)}</>}
            </p>
            {rule.description && <p className="text-xs text-muted-foreground mt-1">{rule.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <RuleToggle id={rule.id} enabled={rule.enabled} locked={rule.locked} />
            <LockButton id={rule.id} locked={rule.locked} lockReason={rule.lockReason} />
            <DeleteRuleButton id={rule.id} name={rule.name} />
          </div>
        </div>
      </div>

      {rule.locked && rule.lockReason && (
        <div className="card-surface p-3 bg-amber-50/40 border border-amber-200">
          <div className="flex items-center gap-2 text-amber-700 text-sm">
            <Lock className="size-4" />
            <strong>Locked</strong> · {rule.lockReason}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Tile label="Total runs" value={String(total)} />
        <Tile label="Succeeded" value={String(succeeded)} tone="emerald" />
        <Tile label="Partial" value={String(partial)} tone="amber" />
        <Tile label="Failed" value={String(failed)} tone={failed > 0 ? "rose" : "muted"} />
      </div>

      {/* Trigger summary */}
      <div className="card-surface p-4 space-y-2">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-brand-cyan" /> Trigger
        </h3>
        <div className="text-sm capitalize">
          {rule.triggerType.replace(/_/g, " ")} ·{" "}
          {rule.triggerType === "record_action" && (
            <span className="font-mono">{cfg.when ?? "create_or_edit"}</span>
          )}
          {rule.triggerType === "date_field" && (
            <span className="font-mono">
              {cfg.when} {cfg.offset} {cfg.unit}(s) of {cfg.field}
            </span>
          )}
          {rule.triggerType === "score_change" && (
            <span className="font-mono">{cfg.direction} on {cfg.field}</span>
          )}
          {rule.triggerType === "recurrence" && <span className="font-mono">{cfg.cron}</span>}
        </div>
      </div>

      {/* Criteria summary */}
      <div className="card-surface p-4">
        <h3 className="font-semibold flex items-center gap-2 text-sm mb-2">
          <AlertTriangle className="size-4 text-amber-600" /> Conditions
        </h3>
        {criteria.length === 0 ? (
          <div className="text-xs italic text-muted-foreground">Runs for every record that triggers.</div>
        ) : (
          <ol className="space-y-1 text-xs font-mono">
            {criteria.map((c, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{i + 1}.</span> {c.field} {c.operator} {String(c.value ?? "")}
              </li>
            ))}
            {rule.criteriaPattern && (
              <li className="text-muted-foreground pt-2 border-t mt-2">Pattern: {rule.criteriaPattern}</li>
            )}
          </ol>
        )}
      </div>

      {/* Instant Actions */}
      <div className="card-surface p-4">
        <h3 className="font-semibold flex items-center gap-2 text-sm mb-2">
          <CheckCircle2 className="size-4 text-emerald-600" /> Instant Actions ({instant.length})
        </h3>
        {instant.length === 0 ? (
          <div className="text-xs italic text-muted-foreground">No instant actions configured.</div>
        ) : (
          <ul className="space-y-1.5">
            {instant.map((a, i) => (
              <li key={i} className="text-xs flex items-center gap-2">
                <span className="chip bg-brand-cyan-light text-brand-cyan-deep">
                  {ACTION_LABELS[a.type] ?? a.type}
                </span>
                <span className="text-muted-foreground font-mono">{summarizeAction(a)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Scheduled Actions */}
      <div className="card-surface p-4">
        <h3 className="font-semibold flex items-center gap-2 text-sm mb-2">
          <Clock className="size-4 text-amber-600" /> Scheduled Actions ({scheduled.length})
        </h3>
        {scheduled.length === 0 ? (
          <div className="text-xs italic text-muted-foreground">No scheduled actions configured.</div>
        ) : (
          <ul className="space-y-1.5">
            {scheduled.map((a, i) => (
              <li key={i} className="text-xs flex items-center gap-2">
                <span className="chip bg-amber-50 text-amber-700">
                  After {a.delay?.amount} {a.delay?.unit}(s) {a.delay?.anchor === "date_field" ? `of ${a.delay?.anchorField}` : ""}
                </span>
                <span className="chip bg-brand-cyan-light text-brand-cyan-deep">
                  {ACTION_LABELS[a.type] ?? a.type}
                </span>
                <span className="text-muted-foreground font-mono">{summarizeAction(a)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent executions */}
      <div className="card-surface overflow-hidden">
        <div className="border-b border-border px-4 py-2.5 font-semibold text-sm">Recent executions ({execs.length})</div>
        {execs.length === 0 ? (
          <div className="p-6 text-xs text-center text-muted-foreground italic">
            No runs yet. Trigger a matching record event to see executions here.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">When</th>
                <th className="text-left py-2 font-medium">Subject</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-right py-2 font-medium">Instant</th>
                <th className="text-right py-2 font-medium pr-4">Scheduled</th>
              </tr>
            </thead>
            <tbody>
              {execs.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-2 tabular-nums">{formatDate(e.executedAt)}</td>
                  <td className="py-2 font-mono text-[10px]">{e.subjectType}/{(e.subjectId ?? "").slice(0, 8)}</td>
                  <td className="py-2">
                    <span
                      className={`chip ${
                        e.status === "succeeded"
                          ? "bg-emerald-50 text-emerald-700"
                          : e.status === "failed"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {e.status}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{(e.instantOutcomes as any[])?.length ?? 0}</td>
                  <td className="py-2 text-right pr-4 tabular-nums">{e.scheduledQueued}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function summarizeAction(a: any): string {
  if (!a.config) return "";
  if (a.type === "send_email" || a.type === "send_whatsapp" || a.type === "send_sms") return `template=${a.config.templateKey ?? "—"}`;
  if (a.type === "create_task" || a.type === "schedule_call") return a.config.title ?? "";
  if (a.type === "update_field") {
    const u = a.config.updates ?? {};
    return Object.entries(u).map(([k, v]) => `${k}=${v}`).join(", ");
  }
  if (a.type === "webhook") return a.config.url ?? "";
  if (a.type === "create_notification") return a.config.title ?? "";
  if (a.type === "add_tag" || a.type === "remove_tag") return a.config.tag ?? "";
  return "";
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "rose" | "amber" | "emerald" | "muted" }) {
  const color =
    tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="card-surface p-3">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
