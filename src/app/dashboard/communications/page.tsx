import Link from "next/link";
import { desc } from "drizzle-orm";
import { MessageCircle, Mail, MessageSquare, CheckCheck, Check, AlertCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import { communications, investors, leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";

const channelIcons = { whatsapp: MessageCircle, email: Mail, sms: MessageSquare };
const statusIcons: Record<string, any> = {
  queued: AlertCircle,
  sent: Check,
  delivered: Check,
  read: CheckCheck,
  replied: CheckCheck,
  failed: AlertCircle,
  bounced: AlertCircle,
  skipped_consent: AlertCircle,
  skipped_compliance: AlertCircle,
  skipped_session: AlertCircle,
  skipped_rate_limit: AlertCircle,
};

export const dynamic = "force-dynamic";

export default async function CommunicationsPage() {
  const session = await requireSession();

  const rows = await withTenant(session.tenantId, async (tx) => {
    // Pull last 200 comms, join investor name
    return tx
      .select({
        comm: communications,
        investorName: investors.name,
        leadName: leads.name,
      })
      .from(communications)
      .leftJoin(investors, eq(investors.id, communications.investorId))
      .leftJoin(leads, eq(leads.id, communications.leadId))
      .orderBy(desc(communications.createdAt))
      .limit(200);
  });

  const counts = rows.reduce(
    (acc, r) => {
      const s = r.comm.status;
      if (s === "sent" || s === "delivered" || s === "read") acc.sent++;
      if (s === "delivered" || s === "read") acc.delivered++;
      if (s === "read" || s === "replied") acc.read++;
      if (s === "replied") acc.replied++;
      return acc;
    },
    { sent: 0, delivered: 0, read: 0, replied: 0 }
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Communications</h1>
        <p className="text-muted-foreground text-sm">
          Unified inbox + outbox. Every send carries a consent + compliance snapshot for audit.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Sent" value={String(counts.sent)} />
        <Stat label="Delivered" value={String(counts.delivered)} />
        <Stat label="Read" value={String(counts.read)} />
        <Stat label="Replies" value={String(counts.replied)} />
      </div>

      <div className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 flex items-center gap-2">
          <button className="text-xs rounded-md bg-accent px-2.5 py-1 font-medium">All</button>
          <button className="text-xs rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent">WhatsApp</button>
          <button className="text-xs rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent">Email</button>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No communications yet. Sends from workflows + manual messages will appear here.
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const c = r.comm;
              const ChannelIcon = channelIcons[c.channel as keyof typeof channelIcons] ?? MessageSquare;
              const StatusIcon = statusIcons[c.status] ?? AlertCircle;
              const recipient = r.investorName ?? r.leadName ?? "—";
              const body = ((c.payload as any)?.rendered ?? (c.inboundContent as any)?.text ?? "").toString();
              return (
                <li key={c.id} className="px-4 py-3 hover:bg-accent/40">
                  <div className="flex items-start gap-3">
                    <div className="size-9 rounded-full bg-muted grid place-items-center flex-shrink-0">
                      <ChannelIcon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{recipient}</span>
                        <span className="text-xs text-muted-foreground">{formatRelative(c.createdAt)}</span>
                        {c.direction === "inbound" && (
                          <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">inbound</span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{body || "—"}</div>
                      <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                        {c.templateKey && <span className="font-mono">{c.templateKey}</span>}
                        {c.workflowRunId && (
                          <Link
                            href={`/dashboard/workflows/runs/${c.workflowRunId}`}
                            className="hover:underline"
                          >
                            via workflow
                          </Link>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <StatusIcon className="size-3.5" />
                      <span className="capitalize">{c.status.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
