"use client";

import React, { useState } from "react";
import {
  TrendingUp,
  Wallet,
  Repeat,
  Users,
  ShieldCheck,
  Target,
  Sparkles,
  ArrowUpRight,
  PieChart,
  Calendar,
  Layers,
  Activity,
} from "lucide-react";
import { ModernDashboardHeader, PeriodOption } from "./ModernDashboardHeader";
import { ModernMetricCard } from "./ModernMetricCard";
import { ModernAttentionCenter } from "./ModernAttentionCenter";
import { ModernFlowsChart } from "./ModernFlowsChart";
import { ModernFunnelAndAllocation } from "./ModernFunnelAndAllocation";
import { ModernRmLeaderboard } from "./ModernRmLeaderboard";

interface ModernDashboardScreenProps {
  userName?: string;
  firmName?: string;
  arnNumber?: string;
  liveStats?: {
    totalAum?: number;
    sipBook?: number;
    netBusiness?: number;
    totalClients?: number;
  };
}

export function ModernDashboardScreen({
  userName = "Pritesh Thakor",
  firmName = "Aina Wealth Advisory",
  arnNumber = "ARN-184920",
  liveStats,
}: ModernDashboardScreenProps) {
  const [period, setPeriod] = useState<PeriodOption>("mtd");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 800);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Header with Firm Info, Time Chips & Actions */}
      <ModernDashboardHeader
        userName={userName}
        firmName={firmName}
        arnNumber={arnNumber}
        selectedPeriod={period}
        onPeriodChange={setPeriod}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {/* 2. Executive Headline KPI Metric Cards (3x2 Grid for optimal readability) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Metric 1: Total AUM */}
        <ModernMetricCard
          title="Total Firm AUM"
          value="₹48.25 Cr"
          subtitle="Equity, Debt, Hybrid & Liquid"
          tone="indigo"
          icon={<TrendingUp className="size-5" />}
          trend={{ value: "+8.4%", direction: "up", label: "FYTD" }}
          sparklineData={[41.2, 42.0, 43.8, 44.1, 46.5, 48.25]}
          href="/dashboard/portfolio-intelligence"
          badge="Live NAV"
        />

        {/* Metric 2: Monthly SIP Book */}
        <ModernMetricCard
          title="Active SIP Book"
          value="₹1.84 Cr"
          subtitle="3,420 Active Monthly SIPs"
          tone="violet"
          icon={<Repeat className="size-5" />}
          trend={{ value: "+₹14.2L", direction: "up", label: "Net Added" }}
          sparklineData={[1.52, 1.58, 1.64, 1.71, 1.78, 1.84]}
          href="/dashboard/sips"
          badge="Recurring"
        />

        {/* Metric 3: Net Sales MTD */}
        <ModernMetricCard
          title="Net Business MTD"
          value="₹5.35 Cr"
          subtitle="Gross ₹7.20 Cr · Outflow ₹1.85 Cr"
          tone="emerald"
          icon={<Wallet className="size-5" />}
          trend={{ value: "+24.8%", direction: "up", label: "vs Last Month" }}
          sparklineData={[3.2, 3.8, 4.1, 4.8, 5.0, 5.35]}
          href="/dashboard/transactions"
        />

        {/* Metric 4: Total Clients / Families */}
        <ModernMetricCard
          title="Active Families"
          value="1,420"
          subtitle="Across 3,940 Live Folios"
          tone="cyan"
          icon={<Users className="size-5" />}
          trend={{ value: "+28", direction: "up", label: "New this month" }}
          sparklineData={[1320, 1345, 1370, 1390, 1405, 1420]}
          href="/dashboard/investors"
        />

        {/* Metric 5: SIP Persistency (13th Mo) */}
        <ModernMetricCard
          title="13M SIP Persistency"
          value="84.6%"
          subtitle="Industry Avg Benchmark: 72%"
          tone="amber"
          icon={<ShieldCheck className="size-5" />}
          trend={{ value: "+2.1%", direction: "up", label: "Top Quartile" }}
          sparklineData={[80.1, 81.2, 82.5, 83.0, 84.1, 84.6]}
          href="/dashboard/sips"
        />

        {/* Metric 6: Lead Conversion Rate */}
        <ModernMetricCard
          title="Lead Conversion Rate"
          value="19.7%"
          subtitle="28 Converted from 142 Leads"
          tone="rose"
          icon={<Target className="size-5" />}
          trend={{ value: "+3.4%", direction: "up", label: "Velocity" }}
          sparklineData={[14.2, 15.0, 16.8, 17.5, 18.9, 19.7]}
          href="/dashboard/leads"
        />
      </div>

      {/* 3. Action Triage Center ("Needs Attention" Queue) */}
      <ModernAttentionCenter />

      {/* 4. Business Net Inflow Trajectory & Asset Class Breakdown */}
      <ModernFlowsChart />

      {/* 5. Conversion Funnel & Client Tier Concentration */}
      <ModernFunnelAndAllocation />

      {/* 6. Advisor & Branch Leaderboard */}
      <ModernRmLeaderboard />
    </div>
  );
}
