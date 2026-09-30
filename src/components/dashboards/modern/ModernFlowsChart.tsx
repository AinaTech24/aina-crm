"use client";

import React, { useState } from "react";
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  PieChart as PieChartIcon,
  HelpCircle,
} from "lucide-react";
import { formatINRShort } from "@/lib/utils";

interface FlowMonthData {
  label: string;
  inflow: number; // in Rupees
  outflow: number; // in Rupees
  net: number;
}

interface AssetClassShare {
  name: string;
  amount: number;
  pct: number;
  color: string;
}

interface ModernFlowsChartProps {
  monthlyData?: FlowMonthData[];
  assetAllocation?: AssetClassShare[];
}

export function ModernFlowsChart({
  monthlyData = [
    { label: "Apr", inflow: 42000000, outflow: 14000000, net: 28000000 },
    { label: "May", inflow: 51000000, outflow: 16500000, net: 34500000 },
    { label: "Jun", inflow: 48000000, outflow: 19000000, net: 29000000 },
    { label: "Jul", inflow: 63000000, outflow: 15000000, net: 48000000 },
    { label: "Aug", inflow: 58000000, outflow: 21000000, net: 37000000 },
    { label: "Sep (MTD)", inflow: 72000000, outflow: 18500000, net: 53500000 },
  ],
  assetAllocation = [
    { name: "Equity Schemes", amount: 328000000, pct: 68, color: "bg-indigo-600" },
    { name: "Hybrid / Balanced Advantage", amount: 86800000, pct: 18, color: "bg-emerald-600" },
    { name: "Debt & Liquid Funds", amount: 53000000, pct: 11, color: "bg-cyan-600" },
    { name: "PMS / AIF / SIF", amount: 14400000, pct: 3, color: "bg-amber-600" },
  ],
}: ModernFlowsChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Chart scaling
  const maxScale = 80000000; // 80 Cr ceiling for clean axis
  const totalInflow = monthlyData.reduce((acc, curr) => acc + curr.inflow, 0);
  const totalOutflow = monthlyData.reduce((acc, curr) => acc + curr.outflow, 0);
  const netBusiness = totalInflow - totalOutflow;
  const retentionPct = totalInflow > 0 ? Math.round((netBusiness / totalInflow) * 100) : 0;

  // Compute SVG coordinates for the Net Trajectory line
  const chartHeight = 200;

  return (
    <div className="rounded-2xl bg-card border border-border/80 shadow-xs p-5 sm:p-6 space-y-6">
      {/* Header & High-Level Inflow KPIs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center size-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200">
              <TrendingUp className="size-4" />
            </span>
            <h2 className="text-base font-bold text-foreground">
              Business Inflows vs Redemptions
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gross sales (SIP additions + Lumpsum) vs Client Redemptions & SWP across months.
          </p>
        </div>

        {/* Quick KPI stats */}
        <div className="flex items-center gap-5 text-xs">
          <div className="text-right">
            <span className="text-2xs text-muted-foreground block font-medium">Total Inflows</span>
            <span className="font-extrabold text-emerald-600 tabular-nums text-sm sm:text-base">
              {formatINRShort(totalInflow)}
            </span>
          </div>
          <div className="h-7 w-px bg-border" />
          <div className="text-right">
            <span className="text-2xs text-muted-foreground block font-medium">Net Retained</span>
            <span className="font-extrabold text-foreground tabular-nums text-sm sm:text-base">
              {formatINRShort(netBusiness)}{" "}
              <span className="text-xs text-emerald-600 font-semibold">({retentionPct}%)</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Chart Graphic */}
      <div className="space-y-2">
        {/* Legend */}
        <div className="flex items-center justify-end gap-5 text-xs font-semibold pb-1">
          <span className="inline-flex items-center gap-2 text-foreground">
            <span className="size-3 rounded-sm bg-emerald-500" /> Gross Inflows
          </span>
          <span className="inline-flex items-center gap-2 text-foreground">
            <span className="size-3 rounded-sm bg-rose-400" /> Outflows / SWP
          </span>
          <span className="inline-flex items-center gap-2 text-foreground">
            <span className="size-3 rounded-full bg-primary" /> Net Sales Trend
          </span>
        </div>

        {/* Bar & Line Container with Y-Axis */}
        <div className="flex items-stretch gap-3 pt-2">
          {/* Y-Axis Labels */}
          <div className="flex flex-col justify-between text-right text-[11px] font-mono text-muted-foreground py-1 select-none w-14 shrink-0">
            <span>₹80 Cr</span>
            <span>₹60 Cr</span>
            <span>₹40 Cr</span>
            <span>₹20 Cr</span>
            <span>₹0 Cr</span>
          </div>

          {/* Chart Grid Canvas */}
          <div className="flex-1 relative h-[210px] border-b border-l border-border/80">
            {/* Horizontal Grid Guidelines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              <div className="border-b border-dashed border-border/60 w-full" />
              <div className="border-b border-dashed border-border/60 w-full" />
              <div className="border-b border-dashed border-border/60 w-full" />
              <div className="border-b border-dashed border-border/60 w-full" />
              <div className="w-full" />
            </div>

            {/* Bars */}
            <div className="absolute inset-0 flex items-end justify-around px-2 sm:px-6">
              {monthlyData.map((item, idx) => {
                const inflowPct = Math.min((item.inflow / maxScale) * 100, 100);
                const outflowPct = Math.min((item.outflow / maxScale) * 100, 100);
                const isHovered = hoveredIdx === idx;

                return (
                  <div
                    key={item.label}
                    className="flex flex-col items-center justify-end h-full w-12 sm:w-16 group cursor-pointer relative z-10"
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  >
                    {/* Tooltip */}
                    {isHovered && (
                      <div className="absolute -top-16 z-30 bg-foreground text-background text-xs rounded-xl p-2.5 shadow-xl whitespace-nowrap pointer-events-none transition-all animate-in fade-in zoom-in-95 border border-border">
                        <div className="font-bold text-white mb-0.5">{item.label}</div>
                        <div className="text-emerald-300 font-medium">Inflows: {formatINRShort(item.inflow)}</div>
                        <div className="text-rose-300 font-medium">Outflows: {formatINRShort(item.outflow)}</div>
                        <div className="font-bold text-white mt-0.5 border-t border-white/20 pt-0.5">
                          Net: {formatINRShort(item.net)}
                        </div>
                      </div>
                    )}

                    {/* Dual Bars */}
                    <div className="flex items-end justify-center gap-1.5 w-full h-full pb-1">
                      {/* Inflow Bar */}
                      <div
                        style={{ height: `${inflowPct}%` }}
                        className={`w-4 sm:w-5 rounded-t-md transition-all duration-200 ${
                          isHovered ? "bg-emerald-400 brightness-110 shadow-sm" : "bg-emerald-500"
                        }`}
                      />
                      {/* Outflow Bar */}
                      <div
                        style={{ height: `${outflowPct}%` }}
                        className={`w-4 sm:w-5 rounded-t-md transition-all duration-200 ${
                          isHovered ? "bg-rose-400 brightness-110 shadow-sm" : "bg-rose-400/80"
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* X-Axis Month Labels */}
        <div className="flex items-center justify-around pl-16 pr-2 sm:px-14 pt-1">
          {monthlyData.map((item, idx) => (
            <span
              key={item.label}
              className={`text-xs font-semibold transition-colors ${
                hoveredIdx === idx ? "text-primary font-bold" : "text-muted-foreground"
              }`}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {/* Asset Class Distribution Strip */}
      <div className="space-y-3 pt-3 border-t border-border/70">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-foreground flex items-center gap-2">
            <Layers className="size-4 text-primary" /> Asset Allocation of Firm AUM
          </span>
          <span className="text-muted-foreground font-semibold">Total ₹48.22 Cr</span>
        </div>

        {/* Stacked Progress Bar */}
        <div className="h-3.5 w-full rounded-full bg-secondary overflow-hidden flex shadow-inner">
          {assetAllocation.map((asset) => (
            <div
              key={asset.name}
              style={{ width: `${asset.pct}%` }}
              className={`${asset.color} hover:opacity-90 transition-all cursor-pointer`}
              title={`${asset.name}: ${asset.pct}% (${formatINRShort(asset.amount)})`}
            />
          ))}
        </div>

        {/* Legend Chips with values */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
          {assetAllocation.map((asset) => (
            <div
              key={asset.name}
              className="p-2.5 rounded-xl bg-secondary/40 border border-border/70 flex items-center justify-between"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`size-2.5 rounded-full ${asset.color} shrink-0`} />
                <span className="text-muted-foreground font-medium truncate">{asset.name}</span>
              </div>
              <span className="font-bold text-foreground tabular-nums ml-1.5 shrink-0">
                {asset.pct}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
