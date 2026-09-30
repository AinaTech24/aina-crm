/**
 * §26 branch · §27 RM · §28 claim owner workload · §29 workload distribution ·
 * §30 insurer · §51 claim type · §52 claim mode. Descriptive tables: no
 * ranking, no score, no verdict on an insurer or a person — settlement is not
 * in an RM's or an owner's control.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, Layers, Landmark, Scale, UserCheck, Users, Workflow } from "lucide-react";
import type { GroupRow } from "@/lib/dashboard/claims/analysis";
import { Num, Section, Table } from "@/components/dashboards/my/Shared";
import { BarRow } from "@/components/dashboards/insurance/parts";
import { formatCount, formatMoney } from "@/lib/format";

type ColKey = keyof Omit<GroupRow, "key">;
type ColDef = { key: ColKey; label: string; format?: "count" | "currency" | "days"; tone?: "warn" | "bad" };

const fmt = (v: number | null, f: ColDef["format"] = "count") =>
  v == null ? <span className="text-muted-foreground">—</span> : f === "currency" ? formatMoney(v) : f === "days" ? `${Math.round(v)} d` : formatCount(v);

export function GroupTable({ rows, cols, keyLabel, labelOf, hrefOf, empty }: {
  rows: GroupRow[]; cols: ColDef[]; keyLabel: string; labelOf: (k: string | null) => ReactNode; hrefOf?: (k: string) => string; empty: string;
}) {
  return (
    <Table rows={rows.length} empty={empty} head={<>
      <th scope="col">{keyLabel}</th>
      {cols.map((c) => <th key={c.key} scope="col" className="text-right">{c.label}</th>)}
    </>}>
      {rows.map((r) => (
        <tr key={r.key ?? "none"}>
          <td className="py-2.5 text-xs font-medium">
            {r.key && hrefOf ? <Link href={hrefOf(r.key)} scroll={false} className="hover:text-primary hover:underline">{labelOf(r.key)}</Link> : labelOf(r.key)}
          </td>
          {cols.map((c) => {
            const v = r[c.key] as number | null;
            return <Num key={c.key} tone={c.tone && typeof v === "number" && v > 0 ? c.tone : "neutral"}>{fmt(v, c.format)}</Num>;
          })}
        </tr>
      ))}
    </Table>
  );
}

export function BranchPanel({ rows, labelOf, hrefOf, periodLabel }: { rows: GroupRow[]; labelOf: (k: string | null) => ReactNode; hrefOf: (k: string) => string; periodLabel: string }) {
  return (
    <Section title="Branch-wise claims" subtitle={`${periodLabel} flows; open and SLA today.`} icon={<Building2 className="size-4" />} className="min-w-0"
      note="A claim belongs to its client's branch, else the branch it was keyed in. Branch → RM → client → claim: pick a branch, then use the RM table, then a client.">
      <GroupTable rows={rows} keyLabel="Branch" labelOf={labelOf} hrefOf={hrefOf} empty="No claims in this view."
        cols={[
          { key: "logged", label: "Logged" }, { key: "open", label: "Open" }, { key: "settled", label: "Settled" }, { key: "rejected", label: "Rejected" },
          { key: "claimed", label: "Logged amount", format: "currency" }, { key: "openAmount", label: "Open amount", format: "currency" },
          { key: "settledAmount", label: "Settled amount", format: "currency" }, { key: "breached", label: "Past SLA", tone: "bad" },
        ]} />
    </Section>
  );
}

export function RmPanel({ rows, labelOf, hrefOf, periodLabel }: { rows: GroupRow[]; labelOf: (k: string | null) => ReactNode; hrefOf: (k: string) => string; periodLabel: string }) {
  return (
    <Section title="RM-wise claim service" subtitle={`Each RM's clients' claims — ${periodLabel} flows, open work today.`} icon={<Users className="size-4" />} className="min-w-0"
      note="By the client's RM. This is coordination, not a ranking: whether a claim settles is the insurer's decision. Follow-up pending is an open claim with no next action, or one whose follow-up date has passed.">
      <GroupTable rows={rows} keyLabel="RM" labelOf={labelOf} hrefOf={hrefOf} empty="No claims in this view."
        cols={[
          { key: "open", label: "Open" }, { key: "docsPending", label: "Documents pending", tone: "warn" }, { key: "settled", label: "Settled" },
          { key: "rejected", label: "Rejected" }, { key: "followUpPending", label: "Follow-up pending", tone: "warn" }, { key: "logged", label: "Logged" },
        ]} />
    </Section>
  );
}

export function OwnerPanel({ rows, labelOf, hrefOf, periodLabel }: { rows: GroupRow[]; labelOf: (k: string | null) => ReactNode; hrefOf: (k: string) => string; periodLabel: string }) {
  return (
    <Section title="Claim owner workload" subtitle={`What each owner holds today, and what they closed in ${periodLabel}.`} icon={<UserCheck className="size-4" />} className="min-w-0"
      note="The owner is the claim's RM field — the CRM has no separate claim-executive field. For spreading the work, not scoring people: an owner holding the oldest claims may simply hold the hardest ones.">
      <GroupTable rows={rows} keyLabel="Owner" labelOf={labelOf} hrefOf={hrefOf} empty="No claims in this view."
        cols={[
          { key: "open", label: "Open" }, { key: "newToday", label: "New today" }, { key: "breached", label: "Past SLA", tone: "bad" },
          { key: "avgAge", label: "Average age", format: "days" }, { key: "docsPending", label: "Documents pending" },
          { key: "queryPending", label: "Query pending" }, { key: "highValue", label: "High value" }, { key: "settled", label: "Settled" },
        ]} />
    </Section>
  );
}

export function DistributionPanel({ owners, types, lines, labelOf }: {
  owners: GroupRow[]; types: Array<{ label: string; n: number; amount: number }>; lines: Array<{ label: string; n: number; amount: number }>;
  labelOf: (k: string | null) => string;
}) {
  const withOpen = owners.filter((o) => o.open > 0);
  const maxN = Math.max(0, ...withOpen.map((o) => o.open));
  const maxA = Math.max(0, ...withOpen.map((o) => o.openAmount));
  const maxB = Math.max(0, ...withOpen.map((o) => o.breached));
  const maxT = Math.max(0, ...types.map((t) => t.n));
  const maxL = Math.max(0, ...lines.map((t) => t.n));
  const block = (title: string, body: ReactNode) => (
    <div className="min-w-0"><h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">{title}</h3>{body}</div>
  );
  return (
    <Section title="Workload distribution" subtitle="Open claims today." icon={<Workflow className="size-4" />}>
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {block("Open claims by owner", withOpen.length ? withOpen.map((o) => <BarRow key={o.key ?? "none"} label={labelOf(o.key)} value={o.open} max={maxN} right={formatCount(o.open)} />) : <p className="text-xs text-muted-foreground">No open claims.</p>)}
        {block("Open claim amount by owner", withOpen.map((o) => <BarRow key={o.key ?? "none"} label={labelOf(o.key)} value={o.openAmount} max={maxA} right={formatMoney(o.openAmount)} />))}
        {block("Past SLA by owner", withOpen.filter((o) => o.breached).length
          ? withOpen.filter((o) => o.breached).map((o) => <BarRow key={o.key ?? "none"} label={labelOf(o.key)} value={o.breached} max={maxB} tone="danger" right={formatCount(o.breached)} />)
          : <p className="text-xs text-muted-foreground">No open claim is past its SLA.</p>)}
        {block("Claim type mix", types.map((t) => <BarRow key={t.label} label={t.label} value={t.n} max={maxT} right={<>{formatCount(t.n)} · {formatMoney(t.amount)}</>} />))}
        {block("Personal vs Commercial workload", lines.map((t) => <BarRow key={t.label} label={t.label} value={t.n} max={maxL} right={<>{formatCount(t.n)} · {formatMoney(t.amount)}</>} />))}
      </div>
    </Section>
  );
}

export function InsurerPanel({ rows, labelOf, hrefOf, periodLabel }: { rows: GroupRow[]; labelOf: (k: string | null) => ReactNode; hrefOf: (k: string) => string; periodLabel: string }) {
  return (
    <Section title="Insurer-wise claims" subtitle={`${periodLabel} flows; open today.`} icon={<Landmark className="size-4" />}
      note="Descriptive only — no insurer is rated. The insurer is the claim's, else its policy's, as keyed; spellings of one name are grouped. Average TAT is intimation to settlement or rejection, grievance cases left out.">
      <GroupTable rows={rows} keyLabel="Insurer" labelOf={labelOf} hrefOf={hrefOf} empty="No claims in this view."
        cols={[
          { key: "logged", label: "Logged" }, { key: "open", label: "Open" }, { key: "settled", label: "Settled" }, { key: "rejected", label: "Rejected" },
          { key: "claimed", label: "Logged amount", format: "currency" }, { key: "openAmount", label: "Open amount", format: "currency" },
          { key: "settledAmount", label: "Settled amount", format: "currency" }, { key: "avgTat", label: "Average TAT", format: "days" },
        ]} />
    </Section>
  );
}

export function TypeModePanel({ types, modes, labelOfType, labelOfMode, typeHref, modeHref, periodLabel }: {
  types: GroupRow[]; modes: GroupRow[]; labelOfType: (k: string | null) => string; labelOfMode: (k: string | null) => string;
  typeHref: (k: string) => string; modeHref: (k: string) => string; periodLabel: string;
}) {
  const cols: ColDef[] = [
    { key: "logged", label: "Logged" }, { key: "open", label: "Open" }, { key: "settled", label: "Settled" }, { key: "rejected", label: "Rejected" },
    { key: "claimed", label: "Logged amount", format: "currency" }, { key: "openAmount", label: "Open amount", format: "currency" },
    { key: "settledAmount", label: "Settled amount", format: "currency" },
  ];
  return (
    <div className="grid gap-6 2xl:grid-cols-2">
      <Section title="Claim type analysis" subtitle={`The CRM's claim types — ${periodLabel} flows, open today.`} icon={<Layers className="size-4" />} className="min-w-0">
        <GroupTable rows={types} cols={cols} keyLabel="Claim type" labelOf={labelOfType} hrefOf={typeHref} empty="No claims in this view." />
      </Section>
      <Section title="Claim mode analysis" subtitle="Cashless, reimbursement and grievance, as recorded." icon={<Scale className="size-4" />} className="min-w-0"
        note="Claim mode is recorded only where it applies; a claim with none reads “Mode not recorded”.">
        <GroupTable rows={modes} cols={cols} keyLabel="Claim mode" labelOf={labelOfMode} hrefOf={modeHref} empty="No claims in this view." />
      </Section>
    </div>
  );
}
