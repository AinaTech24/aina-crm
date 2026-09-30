"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Repeat,
  Wallet,
  Target,
  ShieldCheck,
  TrendingUp,
  Award,
  Bell,
  Search,
  Sparkles,
  ChevronRight,
  Settings,
  HelpCircle,
  FolderOpen,
  PieChart,
  Calendar,
  Layers,
  ArrowLeft,
  CheckCircle2,
  Building2,
  Menu,
  X,
  CreditCard,
  FileText,
} from "lucide-react";
import { ModernDashboardScreen } from "@/components/dashboards/modern/ModernDashboardScreen";

export default function StandalonePreviewDashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navLinks = [
    { label: "Dashboard", href: "#", icon: <LayoutDashboard className="size-4" />, active: true },
    { label: "Investors & Folios", href: "#", icon: <Users className="size-4" />, count: "1,420" },
    { label: "SIP Central", href: "#", icon: <Repeat className="size-4" />, count: "3,420" },
    { label: "Transactions MIS", href: "#", icon: <Wallet className="size-4" /> },
    { label: "Leads & Prospects", href: "#", icon: <Target className="size-4" />, count: "28" },
    { label: "Portfolio Intelligence", href: "#", icon: <PieChart className="size-4" /> },
    { label: "Compliance & DDQ", href: "#", icon: <ShieldCheck className="size-4" />, badge: "98%" },
    { label: "Review Calendar", href: "#", icon: <Calendar className="size-4" /> },
    { label: "Team & RM Targets", href: "#", icon: <Award className="size-4" /> },
    { label: "Settings", href: "#", icon: <Settings className="size-4" /> },
  ];

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* ── Modern Collapsible Sidebar ── */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-18"
        } transition-all duration-300 ease-in-out border-r border-border/80 bg-card flex flex-col shrink-0 z-30`}
      >
        {/* Sidebar Brand Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-border/70">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center shadow-xs text-base shrink-0">
              A
            </div>
            {sidebarOpen && (
              <div className="min-w-0">
                <div className="font-bold text-sm tracking-tight text-foreground truncate">
                  Aina Wealth OS
                </div>
                <div className="text-2xs text-muted-foreground font-mono flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-500" /> ARN-184920
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <Menu className="size-4" />
          </button>
        </div>

        {/* Nav Links */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-none">
          {navLinks.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                item.active
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/70"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="shrink-0">{item.icon}</span>
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </div>
              {sidebarOpen && (item.count || item.badge) && (
                <span
                  className={`text-2xs font-mono px-1.5 py-0.2 rounded-md ${
                    item.active
                      ? "bg-white/20 text-white"
                      : "bg-secondary text-muted-foreground border border-border/60"
                  }`}
                >
                  {item.count || item.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Sidebar Footer User Card */}
        {sidebarOpen && (
          <div className="p-3 border-t border-border/70">
            <div className="p-2.5 rounded-xl bg-secondary/50 border border-border/70 flex items-center gap-2.5">
              <div className="size-8 rounded-full bg-primary/10 text-primary font-bold text-xs grid place-items-center shrink-0">
                PT
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-foreground truncate">Pritesh Thakor</div>
                <div className="text-2xs text-muted-foreground truncate">Owner / Principal</div>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main View Container ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Navbar */}
        <header className="h-16 border-b border-border/80 bg-card/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 z-20">
          {/* Search Pill */}
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search investors, PAN, folios, schemes, tasks... (Press Ctrl + K)"
                className="w-full text-xs bg-secondary/50 border border-border/80 rounded-xl pl-9 pr-14 py-2 text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary transition-all"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs font-mono bg-card px-1.5 py-0.5 rounded border border-border/70 text-muted-foreground">
                ⌘K
              </span>
            </div>
          </div>

          {/* Quick Actions & Profile */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 text-xs font-semibold">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Live Market Feeds Connected</span>
            </div>

            <button
              type="button"
              className="size-9 rounded-xl border border-border/80 bg-secondary/40 hover:bg-secondary grid place-items-center text-muted-foreground hover:text-foreground relative transition-colors"
            >
              <Bell className="size-4" />
              <span className="size-2 rounded-full bg-rose-500 absolute top-2 right-2 ring-2 ring-card" />
            </button>

            <div className="h-6 w-px bg-border/80" />

            <div className="flex items-center gap-2">
              <div className="size-8 rounded-full bg-primary text-primary-foreground font-bold text-xs grid place-items-center">
                PT
              </div>
            </div>
          </div>
        </header>

        {/* Demo Notice Banner */}
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-indigo-500/10 border-b border-primary/20 px-6 py-2.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="font-bold text-foreground">CRM UI/UX Redesign Prototype:</span>
            <span className="text-muted-foreground hidden sm:inline">
              Executive dashboard screen demo featuring high-density metrics, SIP triage queue, and asset allocations.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-700 font-bold bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full text-2xs">
              Ready for Your Approval
            </span>
          </div>
        </div>

        {/* Scrollable Dashboard Body */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
          <ModernDashboardScreen userName="Pritesh" firmName="Aina Wealth Advisory" />
        </main>
      </div>
    </div>
  );
}
