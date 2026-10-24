"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  X,
  Phone,
  MessageSquare,
  Mail,
  TrendingUp,
  Calendar,
  Layers,
  Sparkles,
  Loader2,
  FileText,
  Activity,
  CheckCircle2,
  AlertCircle,
  Shield,
  Clock,
  ArrowRight,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { formatDate, formatINR } from "@/lib/utils";
import { healthBandClasses } from "@/lib/investors/health";
import { contactLogAttrs } from "@/lib/activities/contact-log";

export type SidePeekInvestor = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  aum?: number;
  sip?: number;
  serviceTier?: string | null;
  clientCategory?: string | null;
  segmentTag?: string | null;
  kycStatus?: string | null;
  status?: string | null;
  healthScore?: number;
  healthBand?: any;
  completeness?: number;
};

export function InvestorSidePeek({
  investor,
  onClose,
}: {
  investor: SidePeekInvestor | null;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"overview" | "activity" | "tasks">("overview");
  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!investor?.id) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/investors/${investor.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setDetails(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [investor?.id]);

  if (!investor) return null;

  const phoneClean = investor.phone?.replace(/[^0-9]/g, "") || "";
  const waUrl = phoneClean
    ? `https://wa.me/${phoneClean.length === 10 ? `91${phoneClean}` : phoneClean}`
    : null;

  const drawer = (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-lg bg-card border-l border-border shadow-2xl flex flex-col animate-slide-up sm:animate-none">
          {/* Header */}
          <div className="p-5 border-b border-border/80 bg-muted/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar
                  src={investor.avatarUrl ? `/api/investors/${investor.id}/avatar` : null}
                  name={investor.name}
                  size={48}
                />
                <div>
                  <h2 className="text-lg font-bold text-foreground leading-tight">{investor.name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
                    {investor.pan && (
                      <span className="font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                        {investor.pan}
                      </span>
                    )}
                    {investor.serviceTier && (
                      <span className="font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
                        Tier {investor.serviceTier}
                      </span>
                    )}
                    {investor.kycStatus && (
                      <span
                        className={`px-2 py-0.5 rounded-full font-medium ${
                          investor.kycStatus === "verified"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        KYC {investor.kycStatus}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Quick action icons */}
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/60">
              {investor.phone && (
                <a
                  {...contactLogAttrs({ type: "investor", id: investor.id, name: investor.name })}
                  href={`tel:${investor.phone}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-secondary text-foreground hover:text-brand-cyan hover:bg-secondary/80 transition-colors"
                >
                  <Phone className="size-3" /> Call
                </a>
              )}
              {waUrl && (
                <a
                  {...contactLogAttrs({ type: "investor", id: investor.id, name: investor.name })}
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                >
                  <MessageSquare className="size-3" /> WhatsApp
                </a>
              )}
              {investor.email && (
                <a
                  href={`mailto:${investor.email}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-secondary text-foreground hover:text-brand-cyan hover:bg-secondary/80 transition-colors"
                >
                  <Mail className="size-3" /> Email
                </a>
              )}
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-2 p-4 bg-secondary/30 border-b border-border text-center">
            <div className="p-2 bg-card rounded-lg border border-border/60">
              <span className="text-2xs uppercase font-bold text-muted-foreground tracking-wider block">
                Total AUM
              </span>
              <span className="text-sm font-bold text-foreground tabular-nums">
                {formatINR(investor.aum ?? details?.investor?.aum ?? 0)}
              </span>
            </div>
            <div className="p-2 bg-card rounded-lg border border-border/60">
              <span className="text-2xs uppercase font-bold text-muted-foreground tracking-wider block">
                Monthly SIP
              </span>
              <span className="text-sm font-bold text-brand-navy tabular-nums">
                {formatINR(investor.sip ?? details?.investor?.activeSipAmount ?? 0)}
              </span>
            </div>
            <div className="p-2 bg-card rounded-lg border border-border/60">
              <span className="text-2xs uppercase font-bold text-muted-foreground tracking-wider block">
                Health Score
              </span>
              {/* The API scores live and keeps the stored score equal, so prefer it
                  over the list row's copy; never invent a score while loading. */}
              {(() => {
                const score = details?.health?.score ?? investor.healthScore;
                if (score == null) return <span className="text-sm font-bold text-muted-foreground tabular-nums">—</span>;
                const band = details?.health?.band ?? investor.healthBand ?? (score >= 80 ? "green" : score >= 60 ? "amber" : "red");
                const tone = band === "red" ? "text-rose-700" : band === "amber" ? "text-amber-700" : "text-foreground";
                return (
                  <span className={`text-sm font-bold tabular-nums ${tone}`}>
                    {score}/100 <span className="text-2xs font-medium">{healthBandClasses(band).label}</span>
                  </span>
                );
              })()}
            </div>
          </div>

          {/* Drawer Navigation Tabs */}
          <div className="flex border-b border-border px-4 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`py-2.5 px-3 border-b-2 transition-colors ${
                activeTab === "overview"
                  ? "border-brand-navy text-brand-navy font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Overview & Folios
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("activity")}
              className={`py-2.5 px-3 border-b-2 transition-colors ${
                activeTab === "activity"
                  ? "border-brand-navy text-brand-navy font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Recent Activity
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("tasks")}
              className={`py-2.5 px-3 border-b-2 transition-colors ${
                activeTab === "tasks"
                  ? "border-brand-navy text-brand-navy font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Tasks & Reviews
            </button>
          </div>

          {/* Tab Content Area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
            {loading && !details ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="size-6 animate-spin mb-2 text-brand-cyan" />
                <span>Loading client snapshot…</span>
              </div>
            ) : activeTab === "overview" ? (
              <>
                {/* Profile Overview */}
                <div className="p-3 bg-secondary/40 rounded-xl border border-border/60 space-y-2">
                  <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider text-muted-foreground">
                    Client Details
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground block text-2xs">RM</span>
                      <span className="font-medium text-foreground">{details?.rm?.name ?? (loading ? "…" : "Unassigned")}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-2xs">Branch</span>
                      <span className="font-medium text-foreground">{details?.branch?.name ?? (loading ? "…" : "Not set")}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-2xs">Segment</span>
                      <span className="font-medium text-foreground">{investor.segmentTag ?? details?.investor?.segmentTag ?? "Not set"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-2xs">Category</span>
                      <span className="font-medium text-foreground">
                        {(investor.clientCategory ?? details?.investor?.clientCategory)
                          ? `Category ${investor.clientCategory ?? details?.investor?.clientCategory}`
                          : "Not set"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Folios / Holdings summary */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-foreground">Mutual Fund Folios</h4>
                    <span className="text-2xs text-muted-foreground">
                      {details?.folios?.length ?? 0} active folios
                    </span>
                  </div>

                  {details?.folios && details.folios.length > 0 ? (
                    <div className="space-y-1.5">
                      {details.folios.slice(0, 5).map((f: any) => (
                        <div
                          key={f.id}
                          className="p-2.5 rounded-lg bg-card border border-border/80 flex items-center justify-between"
                        >
                          <div>
                            <span className="font-medium text-foreground block">{f.schemeName ?? f.amcName}</span>
                            <span className="text-2xs text-muted-foreground font-mono">Folio: {f.folioNumber}</span>
                          </div>
                          <span className="font-bold tabular-nums text-foreground">
                            {formatINR(f.currentValue ?? 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground py-3 text-center bg-muted/20 rounded-lg border border-dashed border-border">
                      No mutual fund folios synced yet.
                    </p>
                  )}
                </div>
              </>
            ) : activeTab === "activity" ? (
              <div className="space-y-3">
                <h4 className="font-semibold text-foreground">Recent Transactions & Communications</h4>
                {details?.transactions && details.transactions.length > 0 ? (
                  <div className="space-y-2">
                    {details.transactions.slice(0, 5).map((t: any) => (
                      <div
                        key={t.id}
                        className="p-2.5 rounded-lg bg-card border border-border/80 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <Activity className="size-3.5 text-brand-cyan" />
                          <div>
                            <span className="font-medium text-foreground block capitalize">{t.type}</span>
                            <span className="text-2xs text-muted-foreground">
                              {formatDate(new Date(t.date))}
                            </span>
                          </div>
                        </div>
                        <span className="font-bold tabular-nums text-foreground">{formatINR(t.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground py-6 text-center bg-muted/20 rounded-lg border border-dashed border-border">
                    No recent transaction logs found.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-foreground">Pending Tasks & Reviews</h4>
                  <Link
                    href={`/dashboard/tasks/new?investorId=${investor.id}`}
                    className="text-brand-cyan hover:underline text-xs"
                  >
                    + Add Task
                  </Link>
                </div>
                {details?.tasks && details.tasks.length > 0 ? (
                  <div className="space-y-2">
                    {details.tasks.slice(0, 5).map((t: any) => (
                      <div
                        key={t.id}
                        className="p-2.5 rounded-lg bg-card border border-border/80 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="size-3.5 text-muted-foreground" />
                          <span className="font-medium text-foreground">{t.title}</span>
                        </div>
                        <span className="text-2xs text-muted-foreground">
                          {t.dueAt ? formatDate(new Date(t.dueAt)) : "No due date"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground py-6 text-center bg-muted/20 rounded-lg border border-dashed border-border">
                    No open tasks pending for this investor.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Drawer Footer Action Bar */}
          <div className="p-4 border-t border-border bg-muted/30 flex items-center justify-between gap-3">
            <Link
              href={`/dashboard/investors/${investor.id}`}
              className="btn-primary text-xs inline-flex items-center gap-1.5 px-4 py-2 flex-1 justify-center"
            >
              Open full profile <ArrowRight className="size-3.5" />
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(drawer, document.body) : null;
}
