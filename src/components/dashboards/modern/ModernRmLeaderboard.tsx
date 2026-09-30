"use client";

import React from "react";
import Link from "next/link";
import { Award, TrendingUp, Users, ArrowRight, CheckCircle2 } from "lucide-react";
import { formatINRShort } from "@/lib/utils";

interface RmPerformance {
  rank: number;
  name: string;
  avatarInitials: string;
  branch: string;
  netBusiness: number;
  sipBookAdded: number;
  targetAmount: number;
  achievementPct: number;
  meetingsHeld: number;
  status: "ahead" | "on_track" | "behind";
}

export function ModernRmLeaderboard() {
  const advisors: RmPerformance[] = [
    {
      rank: 1,
      name: "Rajesh Sharma",
      avatarInitials: "RS",
      branch: "Mumbai Main",
      netBusiness: 18400000,
      sipBookAdded: 340000,
      targetAmount: 15000000,
      achievementPct: 122,
      meetingsHeld: 24,
      status: "ahead",
    },
    {
      rank: 2,
      name: "Ananya Patel",
      avatarInitials: "AP",
      branch: "Ahmedabad West",
      netBusiness: 14200000,
      sipBookAdded: 280000,
      targetAmount: 14000000,
      achievementPct: 101,
      meetingsHeld: 21,
      status: "on_track",
    },
    {
      rank: 3,
      name: "Vikram Mehta",
      avatarInitials: "VM",
      branch: "Pune Deccan",
      netBusiness: 11800000,
      sipBookAdded: 210000,
      targetAmount: 12000000,
      achievementPct: 98,
      meetingsHeld: 19,
      status: "on_track",
    },
    {
      rank: 4,
      name: "Siddharth Verma",
      avatarInitials: "SV",
      branch: "Mumbai Main",
      netBusiness: 8600000,
      sipBookAdded: 160000,
      targetAmount: 10000000,
      achievementPct: 86,
      meetingsHeld: 15,
      status: "behind",
    },
  ];

  return (
    <div className="rounded-2xl bg-card border border-border/80 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-secondary/20">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center size-8 rounded-lg bg-amber-500/10 text-amber-600 border border-amber-500/20">
            <Award className="size-4" />
          </span>
          <div>
            <h2 className="text-base font-bold text-foreground">
              RM & Advisory Performance Leaderboard
            </h2>
            <p className="text-xs text-muted-foreground">
              MTD target pacing, net inflows booked, and client meetings completed.
            </p>
          </div>
        </div>

        <Link
          href="/dashboard/team"
          className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
        >
          Full Roster & Targets <ArrowRight className="size-3.5" />
        </Link>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border/70 bg-secondary/30 text-muted-foreground font-semibold">
              <th className="py-3 px-4 w-12 text-center">Rank</th>
              <th className="py-3 px-4">Advisor / Branch</th>
              <th className="py-3 px-4 text-right">Net Business MTD</th>
              <th className="py-3 px-4 text-right">SIP Book Added</th>
              <th className="py-3 px-4 text-center">Meetings</th>
              <th className="py-3 px-4 w-48">Target Pacing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {advisors.map((rm) => {
              const medal =
                rm.rank === 1 ? "🥇" : rm.rank === 2 ? "🥈" : rm.rank === 3 ? "🥉" : `#${rm.rank}`;
              return (
                <tr key={rm.name} className="hover:bg-secondary/40 transition-colors">
                  {/* Rank */}
                  <td className="py-3.5 px-4 text-center font-bold text-sm">
                    {medal}
                  </td>

                  {/* Advisor Name & Branch */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="size-8 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold text-2xs grid place-items-center shrink-0">
                        {rm.avatarInitials}
                      </div>
                      <div>
                        <div className="font-bold text-foreground hover:underline cursor-pointer">
                          {rm.name}
                        </div>
                        <div className="text-2xs text-muted-foreground">{rm.branch}</div>
                      </div>
                    </div>
                  </td>

                  {/* Net Business */}
                  <td className="py-3.5 px-4 text-right font-bold text-foreground tabular-nums">
                    {formatINRShort(rm.netBusiness)}
                  </td>

                  {/* SIP Book Added */}
                  <td className="py-3.5 px-4 text-right font-medium text-emerald-600 tabular-nums">
                    +{formatINRShort(rm.sipBookAdded)}
                  </td>

                  {/* Meetings */}
                  <td className="py-3.5 px-4 text-center font-semibold text-foreground">
                    {rm.meetingsHeld}
                  </td>

                  {/* Target Pacing Progress Bar */}
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-2xs">
                        <span className="font-medium text-muted-foreground">
                          Goal: {formatINRShort(rm.targetAmount)}
                        </span>
                        <span
                          className={`font-bold ${
                            rm.achievementPct >= 100 ? "text-emerald-600" : "text-foreground"
                          }`}
                        >
                          {rm.achievementPct}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          style={{ width: `${Math.min(rm.achievementPct, 100)}%` }}
                          className={`h-full rounded-full ${
                            rm.achievementPct >= 100
                              ? "bg-emerald-500"
                              : rm.achievementPct >= 90
                              ? "bg-indigo-500"
                              : "bg-amber-500"
                          }`}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
