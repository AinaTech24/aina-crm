"use client";

import React from "react";
import Link from "next/link";
import {
  Users,
  Target,
  ArrowRight,
  TrendingUp,
  Award,
  Crown,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { formatINRShort } from "@/lib/utils";

interface FunnelStage {
  name: string;
  count: number;
  pct: number; // percentage of top of funnel
  color: string;
  dropoff?: string;
}

export function ModernFunnelAndAllocation() {
  const funnelStages: FunnelStage[] = [
    { name: "New Leads / Inquiries", count: 142, pct: 100, color: "bg-primary" },
    { name: "Discovery Call / Meeting", count: 88, pct: 62, color: "bg-indigo-500", dropoff: "38% dropoff" },
    { name: "Proposal / Plan Shared", count: 52, pct: 36, color: "bg-violet-500", dropoff: "41% dropoff" },
    { name: "KYC & Mandate Done", count: 36, pct: 25, color: "bg-cyan-500", dropoff: "31% dropoff" },
    { name: "Converted Clients", count: 28, pct: 19.7, color: "bg-emerald-500" },
  ];

  const clientTiers = [
    {
      tier: "Ultra HNI (> ₹5 Cr)",
      count: 14,
      aum: 286000000,
      pctAum: 59,
      badge: "Private Wealth",
      badgeColor: "bg-purple-500/10 text-purple-700 border-purple-500/20",
    },
    {
      tier: "HNI (₹1 Cr – ₹5 Cr)",
      count: 52,
      aum: 124000000,
      pctAum: 26,
      badge: "Premier",
      badgeColor: "bg-indigo-500/10 text-indigo-700 border-indigo-500/20",
    },
    {
      tier: "Emerging (₹25L – ₹1 Cr)",
      count: 194,
      aum: 54000000,
      pctAum: 11,
      badge: "Select",
      badgeColor: "bg-cyan-500/10 text-cyan-700 border-cyan-500/20",
    },
    {
      tier: "Retail (< ₹25L)",
      count: 1160,
      aum: 18200000,
      pctAum: 4,
      badge: "Core SIP",
      badgeColor: "bg-secondary text-muted-foreground border-border/70",
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Lead to Client Pipeline Funnel */}
      <div className="rounded-2xl bg-card border border-border/80 shadow-xs p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Target className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-bold text-foreground">Lead Conversion Pipeline</h2>
              <p className="text-xs text-muted-foreground">
                Funnel velocity & conversion from cold inquiry to funded client.
              </p>
            </div>
          </div>

          <Link
            href="/dashboard/leads"
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
          >
            View Leads <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {/* Funnel Visualizer */}
        <div className="space-y-3 pt-2">
          {funnelStages.map((stage, idx) => (
            <div key={stage.name} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground flex items-center gap-2">
                  <span className="size-5 rounded-full bg-secondary font-mono text-2xs grid place-items-center text-muted-foreground">
                    {idx + 1}
                  </span>
                  {stage.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground tabular-nums">{stage.count}</span>
                  <span className="text-2xs font-medium text-muted-foreground">({stage.pct}%)</span>
                </div>
              </div>

              {/* Progress bar with smooth rounding */}
              <div className="h-2.5 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  style={{ width: `${stage.pct}%` }}
                  className={`h-full rounded-full ${stage.color} transition-all duration-500`}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Conversion Highlights Footer */}
        <div className="pt-3 border-t border-border/60 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="p-2 rounded-xl bg-secondary/40">
            <div className="text-2xs text-muted-foreground font-medium">Conversion Rate</div>
            <div className="font-bold text-emerald-600 text-sm mt-0.5">19.7%</div>
          </div>
          <div className="p-2 rounded-xl bg-secondary/40">
            <div className="text-2xs text-muted-foreground font-medium">Avg. Cycle Time</div>
            <div className="font-bold text-foreground text-sm mt-0.5">14 Days</div>
          </div>
          <div className="p-2 rounded-xl bg-secondary/40">
            <div className="text-2xs text-muted-foreground font-medium">Avg. Ticket Size</div>
            <div className="font-bold text-indigo-600 text-sm mt-0.5">₹3.8 Lakh</div>
          </div>
        </div>
      </div>

      {/* Right: Client Tier Segmentation (HNI Concentration) */}
      <div className="rounded-2xl bg-card border border-border/80 shadow-xs p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center size-8 rounded-lg bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
              <Crown className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-bold text-foreground">Client Tier & AUM Concentration</h2>
              <p className="text-xs text-muted-foreground">
                Distribution of firm AUM across client wealth categories.
              </p>
            </div>
          </div>

          <Link
            href="/dashboard/investors"
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
          >
            All Investors <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {/* Tiers List */}
        <div className="space-y-3 pt-1">
          {clientTiers.map((tier) => (
            <div
              key={tier.tier}
              className="p-3 rounded-xl border border-border/70 bg-secondary/30 hover:bg-secondary/50 transition-colors flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-foreground">{tier.tier}</span>
                  <span className={`text-2xs font-semibold px-2 py-0.2 rounded-full border ${tier.badgeColor}`}>
                    {tier.badge}
                  </span>
                </div>
                <div className="text-2xs text-muted-foreground mt-0.5">
                  {tier.count} Families · Avg. {formatINRShort(Math.round(tier.aum / tier.count))}
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="text-sm font-bold text-foreground tabular-nums">
                  {formatINRShort(tier.aum)}
                </div>
                <div className="text-2xs font-semibold text-primary mt-0.5">
                  {tier.pctAum}% of firm AUM
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Wealth Alert Note */}
        <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/20 text-xs text-indigo-900 flex items-start gap-2.5">
          <Sparkles className="size-4 text-indigo-600 shrink-0 mt-0.5" />
          <div className="text-2xs leading-relaxed">
            <span className="font-semibold">Key Wealth Insight:</span> Top 14 Ultra HNI families contribute 59% of your total AUM. High-touch portfolio reviews are scheduled every 60 days.
          </div>
        </div>
      </div>
    </div>
  );
}
