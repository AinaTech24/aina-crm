"use client";

/**
 * Message Tests: one card per purpose (templates on the same channel for the
 * same job), each template's rates side by side and the verdict on which one
 * clients answer. Data from lib/practice/experiments.ts templatePerformance.
 */

import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import type { PurposeGroup, TemplateStats, RateKey } from "@/lib/practice/experiments";

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email", sms: "SMS" };
const METRIC_WORD: Record<RateKey, string> = { replied: "reply rate", read: "read rate", delivered: "delivery rate" };

const pctCell = (v: number | null, reported: boolean) =>
  !reported ? <span className="text-2xs text-muted-foreground">Not reported</span> : v == null ? "—" : `${v.toFixed(1)}%`;

function verdict(g: PurposeGroup): { text: string; tone: "neutral" | "success" } {
  const name = (id: string) => g.templates.find((t) => t.id === id)?.name ?? "One template";
  const c = g.comparison;
  switch (c.kind) {
    case "single":
      return { text: "Only one template for this purpose — create a variant to test.", tone: "neutral" };
    case "no_metric":
      return { text: "This channel reports nothing to compare in the period.", tone: "neutral" };
    case "too_few":
      return { text: "Too few sends to compare (each template needs at least 30).", tone: "neutral" };
    case "no_difference":
      return { text: `No clear difference yet between ${name(c.leaderId)} and ${name(c.runnerUpId)}.`, tone: "neutral" };
    case "better":
      return { text: `${name(c.winnerId)} does better on ${g.metric ? METRIC_WORD[g.metric] : "the outcome"} than ${name(c.runnerUpId)}.`, tone: "success" };
  }
}

function GroupTable({ g }: { g: PurposeGroup }) {
  const winner = g.comparison.kind === "better" ? g.comparison.winnerId : null;
  const columns: Column<TemplateStats>[] = [
    {
      key: "template",
      header: "Template",
      cell: (t) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {t.templateId ? (
              <Link href={`/dashboard/templates/${t.templateId}`} className="font-medium hover:underline">{t.name}</Link>
            ) : (
              <span className="font-medium">{t.name}</span>
            )}
            {winner === t.id && <Badge tone="success" raw>Better</Badge>}
          </div>
          <div className="text-2xs text-muted-foreground">
            {t.key}{t.category ? ` · ${t.category}` : ""}
          </div>
        </div>
      ),
    },
    { key: "sent", header: "Sent", align: "right", cell: (t) => t.sent.toLocaleString("en-IN") },
    { key: "delivered", header: "Delivered", align: "right", cell: (t) => pctCell(t.deliveredPct, g.reported.delivered) },
    { key: "read", header: g.channel === "email" ? "Opened" : "Read", align: "right", cell: (t) => pctCell(t.readPct, g.reported.read) },
    { key: "replied", header: "Replied", align: "right", cell: (t) => pctCell(t.repliedPct, g.reported.replied) },
    { key: "failed", header: "Failed", align: "right", hideOnMobile: true, cell: (t) => (t.failedPct == null ? "—" : `${t.failedPct.toFixed(1)}%`) },
    { key: "skipped", header: "Skipped", align: "right", hideOnMobile: true, cell: (t) => (t.skippedPct == null ? "—" : `${t.skippedPct.toFixed(1)}%`) },
  ];
  return <DataTable rows={g.templates} columns={columns} rowKey={(t) => t.id} caption={`${g.label} templates on ${CHANNEL_LABEL[g.channel] ?? g.channel}`} />;
}

export function ExperimentGroups({ groups }: { groups: PurposeGroup[] }) {
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const v = verdict(g);
        return (
          <Card key={`${g.channel}:${g.purpose}`}>
            <CardHeader
              title={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {g.label}
                  <Badge tone="neutral" raw>{CHANNEL_LABEL[g.channel] ?? g.channel}</Badge>
                </span>
              }
              subtitle={<span className={v.tone === "success" ? "text-success" : undefined}>{v.text}</span>}
            />
            <CardBody padded={false}>
              <GroupTable g={g} />
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
