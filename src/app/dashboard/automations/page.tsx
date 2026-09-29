/**
 * Automations → Rules. Every rule grouped by the module it watches, each said
 * in plain English: When it runs, what it Does, when it last ran, how often in
 * the last 30 days, how many of those failed, and an on/off switch.
 *
 * "Since created" is the rule's lifetime counter (what the old list called
 * "Fired"); "Runs (30d)" counts executions in the last 30 days. The old list
 * printed only the lifetime number next to a 7-day monitor, which is how
 * "Fired 22" sat beside "0 runs".
 */
import Link from "next/link";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { AlertTriangle, Lock, Workflow } from "lucide-react";
import { withTenant } from "@/db/client";
import { templates, workflowRules, workflowRuleExecutions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { MODULES, type ModuleKey } from "@/lib/workflow-rules/modules";
import { describeDoes, describeWhen, nameProblem, templateRefs } from "@/lib/workflow-rules/describe";
import { canViewMonitor } from "@/lib/automation/control-tower";
import { RuleToggle } from "@/components/workflow-rules/RuleToggle";
import { MoveRuleButton } from "@/components/workflow-rules/MoveRuleButton";
import { ClickableRow } from "@/components/common/ClickableRow";
import { EmptyState } from "@/components/common/EmptyState";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

export default async function AutomationRulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const moduleFilter = sp.module ?? "";
  const canSeeHistory = canViewMonitor(session.roles, session.permissions);

  const { rules, stats, templateNames } = await withTenant(
    session.tenantId,
    async (tx) => {
      const all = await tx
        .select()
        .from(workflowRules)
        .where(eq(workflowRules.tenantId, session.tenantId))
        .orderBy(workflowRules.module, workflowRules.executionOrder, desc(workflowRules.createdAt));

      // Runs and failures in the window, per rule, in one grouped pass.
      const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
      const exec = await tx
        .select({
          ruleId: workflowRuleExecutions.ruleId,
          runs: sql<number>`count(*)`.mapWith(Number),
          failed: sql<number>`count(*) filter (where ${workflowRuleExecutions.status} in ('failed','partial'))`.mapWith(Number),
        })
        .from(workflowRuleExecutions)
        .where(and(eq(workflowRuleExecutions.tenantId, session.tenantId), gte(workflowRuleExecutions.executedAt, since)))
        .groupBy(workflowRuleExecutions.ruleId);

      // Template names for "Sends email “Welcome”", looked up once.
      const refs = all.flatMap((r) => templateRefs(r));
      const keys = [...new Set(refs.map((r) => r.key))];
      const tpl = keys.length
        ? await tx
            .select({ key: templates.key, channel: templates.channel, name: templates.name })
            .from(templates)
            .where(and(eq(templates.tenantId, session.tenantId), inArray(templates.key, keys)))
        : [];

      return {
        rules: all,
        stats: new Map(exec.map((e) => [e.ruleId, e])),
        templateNames: new Map(tpl.map((t) => [`${t.channel}:${t.key}`, t.name])),
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const templateName = (channel: string, key: string) => templateNames.get(`${channel}:${key}`) ?? undefined;
  const flagged = rules
    .map((r) => ({ rule: r, problem: nameProblem({ name: r.name, module: r.module }) }))
    .filter((x): x is { rule: (typeof rules)[number]; problem: string } => !!x.problem);

  const shown = moduleFilter ? rules.filter((r) => r.module === moduleFilter) : rules;
  const byModule = new Map<string, typeof rules>();
  for (const r of shown) byModule.set(r.module, [...(byModule.get(r.module) ?? []), r]);

  if (rules.length === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title="No automations yet"
        description="Automations do repetitive work for you: a birthday wish, a welcome email, a task when a SIP bounces. Use “New automation” above to start from a recipe."
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Rules whose names don't say what they do. */}
      {flagged.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">
                {flagged.length === 1 ? "1 automation looks like a test" : `${flagged.length} automations look like tests`} or
                {flagged.length === 1 ? " has a name" : " have names"} that don&apos;t say what they do. Rename or delete them so
                everyone knows what runs.
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                {flagged.map(({ rule, problem }) => (
                  <li key={rule.id}>
                    <Link href={`/dashboard/workflows/rules/${rule.id}`} className="font-semibold underline-offset-2 hover:underline">
                      “{rule.name}”
                    </Link>{" "}
                    <span className="text-amber-800">— {problem}.</span>{" "}
                    <Link href={`/dashboard/workflows/rules/${rule.id}`} className="font-medium underline underline-offset-2">
                      Rename or delete
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Module filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Link
          href="/dashboard/automations"
          className={`chip text-2xs ${!moduleFilter ? "bg-foreground text-background" : "bg-secondary text-foreground hover:bg-secondary/70"}`}
        >
          All · {rules.length}
        </Link>
        {Object.values(MODULES).map((mod) => {
          const count = rules.filter((r) => r.module === mod.key).length;
          if (count === 0 && moduleFilter !== mod.key) return null;
          return (
            <Link
              key={mod.key}
              href={`/dashboard/automations?module=${mod.key}`}
              className={`chip text-2xs ${moduleFilter === mod.key ? "bg-foreground text-background" : "bg-secondary text-foreground hover:bg-secondary/70"}`}
            >
              {mod.label} · {count}
            </Link>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Runs (30d)</span> counts the last {WINDOW_DAYS} days.{" "}
        <span className="font-medium text-foreground">Since created</span> is every run since the automation was made (the old
        “Fired” number). Failures link to those runs in Run history.
      </p>

      {[...byModule.entries()].map(([moduleKey, items]) => {
        const mod = MODULES[moduleKey as ModuleKey];
        return (
          <section key={moduleKey} aria-label={mod?.label ?? moduleKey} className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">
              {mod?.label ?? moduleKey} <span className="font-normal text-muted-foreground">· {items.length}</span>
            </h2>
            <div className="card-surface overflow-hidden">
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="relative w-14 px-3 py-2"><span className="sr-only">Order</span></th>
                      <th className="text-left py-2 pr-3 font-medium">Name</th>
                      <th className="text-left py-2 pr-3 font-medium">When</th>
                      <th className="text-left py-2 pr-3 font-medium">Does</th>
                      <th className="text-left py-2 pr-3 font-medium">Last run</th>
                      <th className="text-right py-2 pr-3 font-medium">Runs (30d)</th>
                      <th className="text-right py-2 pr-3 font-medium">Failures</th>
                      <th className="text-center py-2 pr-4 font-medium">On</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r, index) => {
                      const s = stats.get(r.id);
                      const runs = s?.runs ?? 0;
                      const failed = s?.failed ?? 0;
                      const does = describeDoes(r, templateName);
                      return (
                        <ClickableRow key={r.id} href={`/dashboard/workflows/rules/${r.id}`} className="border-b last:border-0 hover:bg-secondary/40 align-top">
                          <td className="px-3 py-3">
                            {items.length > 1 && (
                              <div className="flex items-center gap-0.5">
                                <MoveRuleButton id={r.id} direction="up" disabled={index === 0} />
                                <MoveRuleButton id={r.id} direction="down" disabled={index === items.length - 1} />
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-3 !whitespace-normal min-w-44">
                            <div className="flex items-center gap-1.5">
                              {r.locked && <Lock className="size-3 text-muted-foreground" aria-label="Locked" />}
                              <Link href={`/dashboard/workflows/rules/${r.id}`} className="font-medium text-foreground hover:underline">
                                {r.name}
                              </Link>
                            </div>
                            {r.description && <div className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground">{r.description}</div>}
                          </td>
                          <td className="py-3 pr-3 text-xs text-foreground !whitespace-normal min-w-44">{describeWhen(r)}</td>
                          <td className="py-3 pr-3 text-xs text-foreground !whitespace-normal min-w-52">
                            {does.length === 0 ? (
                              <span className="text-muted-foreground">Nothing yet (no actions)</span>
                            ) : (
                              <>
                                {does.slice(0, 2).map((d, i) => (
                                  <div key={i}>{d}</div>
                                ))}
                                {does.length > 2 && <div className="text-muted-foreground">+{does.length - 2} more</div>}
                              </>
                            )}
                          </td>
                          <td className="py-3 pr-3 text-xs text-muted-foreground">
                            {r.lastExecutedAt ? formatRelative(r.lastExecutedAt) : "Never"}
                          </td>
                          <td className="py-3 pr-3 text-right tabular-nums">
                            <div className="text-foreground">{runs.toLocaleString("en-IN")}</div>
                            <div className="text-2xs text-muted-foreground" title="Every run since the automation was created">
                              {(r.executionCount ?? 0).toLocaleString("en-IN")} since created
                            </div>
                          </td>
                          <td className="py-3 pr-3 text-right tabular-nums">
                            {failed === 0 ? (
                              <span className="text-muted-foreground">0</span>
                            ) : canSeeHistory ? (
                              <Link
                                href={`/dashboard/automations/history?rule=${r.id}&status=failed`}
                                className="font-medium text-rose-700 underline-offset-2 hover:underline"
                              >
                                {failed.toLocaleString("en-IN")}
                              </Link>
                            ) : (
                              <span className="font-medium text-rose-700">{failed.toLocaleString("en-IN")}</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-center">
                            <RuleToggle id={r.id} enabled={r.enabled} locked={r.locked} />
                          </td>
                        </ClickableRow>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
