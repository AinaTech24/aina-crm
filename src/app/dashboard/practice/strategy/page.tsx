import Link from "next/link";
import { Compass, ShieldAlert } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { PracticeNav } from "@/components/practice/PracticeNav";
import { StrategyEditor } from "@/components/practice/StrategyEditor";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, InlineEmpty } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { canManagePractice, canViewPractice } from "@/lib/practice/access";
import {
  FIGURES,
  currentFigures,
  fyEndYear,
  fyLabelOf,
  loadFyTargets,
  loadStrategy,
  strategyRows,
  type StrategyRow,
} from "@/lib/practice/strategy";
import { PathTable, YearByYearTable, type PathRowView } from "./StrategyTables";
import { fmtFigure } from "./figure-format";

export const dynamic = "force-dynamic";

function objectiveSentence(rows: StrategyRow[], year: number | null): string {
  const parts = rows.map((r) => {
    const v = fmtFigure(r.target, r.unit);
    switch (r.key) {
      case "aum": return `${v} AUM`;
      case "clients": return `${v} clients`;
      case "sipBook": return `a ${v} monthly SIP book`;
      case "revenue": return `${v} revenue a year`;
      case "teamSize": return `a team of ${v}`;
      case "ownerHoursPerWeek": return `the owner working ${v} a week`;
    }
  });
  if (!parts.length) return "No figure set yet.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${list[0].toUpperCase()}${list.slice(1)}${year ? ` by the end of FY${year}` : ""}.`;
}

export default async function StrategicObjectivePage() {
  const session = await requireSession();
  const header = (
    <>
      <PageHeaderCard
        title="Strategic Objective"
        subtitle="What the practice is for, in figures — and whether this year keeps it on the way."
      />
      <PracticeNav active="strategy" />
    </>
  );
  if (!canViewPractice(session)) {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState
          icon={ShieldAlert}
          title="For the people who run the firm"
          description="The strategic objective is set by the owner and read by branch heads and compliance."
        />
      </div>
    );
  }
  const canEdit = canManagePractice(session);
  const now = new Date();
  const fy = fyEndYear(now);
  const fyLabel = fyLabelOf(fy);

  const { strategy, current, fyTargets } = await withTenant(session.tenantId, async (tx) => ({
    strategy: await loadStrategy(tx, session.tenantId),
    current: await currentFigures(tx, session.tenantId, now),
    fyTargets: await loadFyTargets(tx, session.tenantId, fyLabel),
  }), { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

  const editorValue = {
    primaryAim: strategy?.primaryAim ?? null,
    objectiveYear: strategy?.objectiveYear ?? null,
    targets: strategy?.targets ?? {},
    ownerHoursNow: strategy?.baseline.ownerHoursNow ?? null,
  };

  if (!strategy) {
    return (
      <div className="space-y-5">
        {header}
        <Card>
          <CardHeader
            icon={<Compass className="size-5" aria-hidden />}
            title="What do you want the practice to give you — and when?"
            subtitle="Gerber's first question. Write the answer, then the figures that would prove it: AUM, clients, the SIP book, the team, the hours you still work in it."
          />
          <CardBody>
            {canEdit ? (
              <StrategyEditor value={editorValue} isNew startOpen />
            ) : (
              <InlineEmpty message="The owner has not set the strategic objective yet." />
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  const rows = strategyRows(strategy, current, fyTargets, now);
  const views: PathRowView[] = rows.map((r) => ({
    key: r.key,
    label: r.label,
    unit: r.unit,
    baseline: r.baseline,
    current: r.current,
    currentNote: r.currentNote,
    neededThisYear: r.path?.neededThisYear ?? null,
    target: r.target,
    progress: r.progress,
    status: r.status,
    compound: r.path?.compound ?? false,
    perYear: r.path?.perYear ?? null,
    points: r.path?.points ?? [],
  }));
  const capturedOn = strategy.baseline.capturedOn;
  const comparable = rows.filter((r) => r.key === "aum" || r.key === "sipBook" || r.key === "clients");

  return (
    <div className="space-y-5">
      {header}

      <Card>
        <CardHeader
          icon={<Compass className="size-5" aria-hidden />}
          title="The primary aim"
          subtitle="What the owner wants the practice to give them — and when."
        />
        <CardBody className="space-y-3">
          {strategy.primaryAim ? (
            <blockquote className="border-l-2 border-primary pl-4 text-base leading-relaxed whitespace-pre-line">
              {strategy.primaryAim}
            </blockquote>
          ) : (
            <InlineEmpty message="No primary aim written yet." />
          )}
          <p className="text-sm">
            <span className="font-medium">The objective: </span>
            {objectiveSentence(rows, strategy.objectiveYear)}
          </p>
          {canEdit && <StrategyEditor value={editorValue} isNew={false} />}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="On the way?"
          subtitle={`Baseline${capturedOn ? ` as on ${formatDate(capturedOn)}` : ""}; money grows on a steady annual rate, counts on a straight line. Status compares today with where the path stands today.`}
        />
        <CardBody padded={false}>
          {views.length ? (
            <PathTable rows={views} fyLabel={`FY ${fyLabel}`} objectiveLabel={strategy.objectiveYear ? `Objective FY${strategy.objectiveYear}` : "Objective"} />
          ) : (
            <InlineEmpty message="No figure set in the objective yet." />
          )}
        </CardBody>
      </Card>

      {views.some((v) => v.points.length > 1) && (
        <Card>
          <CardHeader title="Year by year" subtitle="Where each figure needs to be by 31 March of each year." />
          <CardBody padded={false}>
            <YearByYearTable rows={views} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`This year's targets against the path (FY ${fyLabel})`}
          subtitle="The annual targets are the steps; the objective is where they lead."
          action={<Link href="/dashboard/settings/targets" className="text-sm text-primary hover:underline">Settings → Targets</Link>}
        />
        <CardBody>
          {comparable.length ? (
            <ul className="divide-y divide-border text-sm">
              {comparable.map((r) => (
                <li key={r.key} className="py-2.5">
                  <TargetLine row={r} fyLabel={fyLabel} />
                </li>
              ))}
            </ul>
          ) : (
            <InlineEmpty message="The objective sets no AUM, SIP book or client figure to compare with an annual target." />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

const TARGET_NOUN: Partial<Record<StrategyRow["key"], string>> = { aum: "AUM", clients: "new clients", sipBook: "SIP book" };

function TargetLine({ row, fyLabel }: { row: StrategyRow; fyLabel: string }) {
  const label = FIGURES[row.key].label;
  const noun = TARGET_NOUN[row.key] ?? label;
  if (!row.path) {
    return <span className="text-muted-foreground">{label}: no baseline on record, so no path to compare with.</span>;
  }
  const t = row.fyTarget;
  if (!t) {
    const ask = fmtFigure(row.path.neededThisYear - row.path.neededAtYearStart, row.unit);
    return (
      <span>
        No {noun} target is set for FY {fyLabel}. <span className="text-muted-foreground">The path asks for {row.key === "clients" ? `${ask} more clients (net)` : `${ask} added`} this year.</span>
      </span>
    );
  }
  const what = t.kind === "closing" ? `${noun} target` : row.key === "clients" ? "new clients target" : `${noun} addition target`;
  const pathWords = row.key === "clients"
    ? `the path needs ${fmtFigure(t.pathAsk, row.unit)} more clients, net of any who leave`
    : t.kind === "closing"
      ? `the path needs ${fmtFigure(t.pathAsk, row.unit)} by 31 March`
      : `the path needs ${fmtFigure(t.pathAsk, row.unit)} added`;
  const short = row.dir === "up" ? t.value < t.pathAsk : t.value > t.pathAsk;
  return (
    <span>
      This year&apos;s {what} is <span className="font-medium">{fmtFigure(t.value, row.unit)}</span>; {pathWords}.{" "}
      <span className={short ? "text-warning-foreground" : "text-muted-foreground"}>
        {short ? "The target falls short of the path." : "The target keeps to the path."}
      </span>
      <span className="block text-2xs text-muted-foreground">From the {t.source}.</span>
    </span>
  );
}
