"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Calendar,
  Filter,
  Plus,
  ArrowUpRight,
  Download,
  RotateCw,
  Sparkles,
  Building2,
  Users,
  ChevronDown,
  Clock,
  ShieldCheck,
} from "lucide-react";

export type PeriodOption = "mtd" | "qtd" | "fytd" | "30d" | "custom";

interface ModernDashboardHeaderProps {
  userName: string;
  firmName: string;
  arnNumber?: string;
  selectedPeriod: PeriodOption;
  onPeriodChange?: (period: PeriodOption) => void;
  members?: { id: string; name: string }[];
  branches?: { id: string; name: string }[];
  selectedMember?: string;
  selectedBranch?: string;
  onMemberChange?: (memberId: string) => void;
  onBranchChange?: (branchId: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function ModernDashboardHeader({
  userName,
  firmName,
  arnNumber = "ARN-184920",
  selectedPeriod = "mtd",
  onPeriodChange,
  members = [
    { id: "all", name: "All Relationship Managers" },
    { id: "1", name: "Rajesh Sharma (Senior RM)" },
    { id: "2", name: "Ananya Patel (Wealth Advisor)" },
    { id: "3", name: "Vikram Mehta (Branch Head)" },
  ],
  branches = [
    { id: "all", name: "All Branches" },
    { id: "b1", name: "Mumbai Main" },
    { id: "b2", name: "Pune Deccan" },
    { id: "b3", name: "Ahmedabad West" },
  ],
  selectedMember = "all",
  selectedBranch = "all",
  onMemberChange,
  onBranchChange,
  onRefresh,
  isRefreshing = false,
}: ModernDashboardHeaderProps) {
  const [period, setPeriod] = useState<PeriodOption>(selectedPeriod);
  const [member, setMember] = useState(selectedMember);
  const [branch, setBranch] = useState(selectedBranch);

  const handlePeriod = (p: PeriodOption) => {
    setPeriod(p);
    onPeriodChange?.(p);
  };

  const handleMember = (m: string) => {
    setMember(m);
    onMemberChange?.(m);
  };

  const handleBranch = (b: string) => {
    setBranch(b);
    onBranchChange?.(b);
  };

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const formattedDate = now.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      {/* Top Banner: Greeting, Firm ARN Badge & Primary Quick Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 p-5 sm:p-6 rounded-2xl bg-card border border-border/80 shadow-xs relative overflow-hidden">
        {/* Subtle background glow effect */}
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-10 w-48 h-48 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="space-y-1 relative z-10">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              <Sparkles className="size-3" /> Executive Cockpit
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-secondary text-secondary-foreground font-mono text-2xs border border-border/70">
              <ShieldCheck className="size-3 text-emerald-600" /> {arnNumber}
            </span>
            <span className="text-muted-foreground flex items-center gap-1 font-medium">
              <Clock className="size-3" /> {formattedDate}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {greeting}, <span className="text-primary">{userName}</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">
            Here is your firm-wide AUM trajectory, active SIP book health, and client action queues for <span className="font-semibold text-foreground">{firmName}</span>.
          </p>
        </div>

        {/* Right side Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 relative z-10">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/80 bg-secondary/50 text-foreground hover:bg-secondary hover:border-border transition-colors disabled:opacity-50"
            title="Refresh metrics"
          >
            <RotateCw className={`size-3.5 ${isRefreshing ? "animate-spin text-primary" : "text-muted-foreground"}`} />
            <span className="hidden sm:inline">Sync Data</span>
          </button>

          <Link
            href="/dashboard/leads/new"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-border/80 bg-secondary hover:bg-secondary/80 text-foreground transition-colors shadow-2xs"
          >
            <Plus className="size-3.5 text-muted-foreground" />
            <span>New Lead</span>
          </Link>

          <Link
            href="/dashboard/transactions"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-xs hover:shadow-sm"
          >
            <Plus className="size-3.5" />
            <span>Book Business</span>
          </Link>
        </div>
      </div>

      {/* Control Bar: Time-Period Chips & Filters */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3.5 p-3 sm:px-4 sm:py-3 rounded-xl bg-card border border-border/70 shadow-2xs">
        {/* Left: Time Period Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground mr-1.5">
            Period:
          </span>
          {(
            [
              { key: "mtd", label: "MTD" },
              { key: "qtd", label: "Q2 FY27 (QTD)" },
              { key: "fytd", label: "FY 2026-27" },
              { key: "30d", label: "Last 30 Days" },
              { key: "custom", label: "Custom Range" },
            ] as const
          ).map((item) => {
            const active = period === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handlePeriod(item.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Right: Relationship Manager & Branch Scopes */}
        <div className="flex flex-wrap items-center gap-2">
          {/* RM Filter */}
          <div className="relative">
            <select
              value={member}
              aria-label="Filter by Relationship Manager"
              onChange={(e) => handleMember(e.target.value)}
              className="appearance-none text-xs font-medium bg-secondary/50 border border-border/80 text-foreground rounded-lg pl-8 pr-7 py-1.5 hover:bg-secondary cursor-pointer focus:ring-1 focus:ring-primary"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <Users className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <ChevronDown className="size-3 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Branch Filter */}
          <div className="relative hidden sm:block">
            <select
              value={branch}
              aria-label="Filter by Branch"
              onChange={(e) => handleBranch(e.target.value)}
              className="appearance-none text-xs font-medium bg-secondary/50 border border-border/80 text-foreground rounded-lg pl-8 pr-7 py-1.5 hover:bg-secondary cursor-pointer focus:ring-1 focus:ring-primary"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <Building2 className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <ChevronDown className="size-3 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>
    </div>
  );
}
