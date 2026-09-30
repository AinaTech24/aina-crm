"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  MessageSquare,
  PhoneCall,
  ChevronRight,
  ShieldAlert,
  Clock,
  CheckCircle2,
  Calendar,
  Sparkles,
  ArrowRight,
  FileCheck,
  UserCheck,
} from "lucide-react";
import { formatINR } from "@/lib/utils";

export interface SipRejectionItem {
  id: string;
  investorName: string;
  schemeName: string;
  amount: number;
  reason: string;
  date: string;
  phone: string;
}

export interface ComplianceGapItem {
  id: string;
  investorName: string;
  pan: string;
  issue: string;
  severity: "high" | "medium";
  aum: number;
}

export interface ReviewDueItem {
  id: string;
  investorName: string;
  aum: number;
  lastReviewDaysAgo: number;
  tier: string;
  rmName: string;
}

interface ModernAttentionCenterProps {
  rejections?: SipRejectionItem[];
  complianceGaps?: ComplianceGapItem[];
  reviewsDue?: ReviewDueItem[];
  onQuickWhatsApp?: (item: SipRejectionItem) => void;
}

export function ModernAttentionCenter({
  rejections = [
    {
      id: "sr-1",
      investorName: "Rameshwar Kulkarni",
      schemeName: "HDFC Top 100 Fund - Reg (G)",
      amount: 25000,
      reason: "NACH mandate limit exceeded",
      date: "Today, 09:30 AM",
      phone: "+91 98201 44521",
    },
    {
      id: "sr-2",
      investorName: "Pooja Singhania",
      schemeName: "Nippon India Small Cap Fund",
      amount: 15000,
      reason: "Insufficient bank balance",
      date: "Yesterday",
      phone: "+91 98112 39012",
    },
    {
      id: "sr-3",
      investorName: "Dr. Arvind Swaminathan",
      schemeName: "ICICI Pru Bluechip Fund",
      amount: 50000,
      reason: "Account frozen / Dormant status",
      date: "20 Sep 2026",
      phone: "+91 99304 88710",
    },
  ],
  complianceGaps = [
    {
      id: "cg-1",
      investorName: "Kavita Narang",
      pan: "ABC**1294K",
      issue: "Nominee registration pending",
      severity: "high",
      aum: 4250000,
    },
    {
      id: "cg-2",
      investorName: "Harishankar Varma",
      pan: "BFZ**4481M",
      issue: "Risk profiling expired (SEBI mandatory)",
      severity: "medium",
      aum: 8900000,
    },
    {
      id: "cg-3",
      investorName: "Sunil Agarwal (HUF)",
      pan: "AAL**9082F",
      issue: "Re-KYC address proof outdated",
      severity: "high",
      aum: 15400000,
    },
  ],
  reviewsDue = [
    {
      id: "rd-1",
      investorName: "Deepak Chopra & Family",
      aum: 48500000,
      lastReviewDaysAgo: 112,
      tier: "Ultra HNI",
      rmName: "Rajesh Sharma",
    },
    {
      id: "rd-2",
      investorName: "Meenakshi Sundaram",
      aum: 26000000,
      lastReviewDaysAgo: 98,
      tier: "HNI",
      rmName: "Ananya Patel",
    },
    {
      id: "rd-3",
      investorName: "Capt. Rahul Joshi",
      aum: 18500000,
      lastReviewDaysAgo: 94,
      tier: "HNI",
      rmName: "Vikram Mehta",
    },
  ],
}: ModernAttentionCenterProps) {
  const [activeTab, setActiveTab] = useState<"sip" | "compliance" | "reviews">("sip");
  const [contactedIds, setContactedIds] = useState<Record<string, boolean>>({});

  const handleWhatsAppClick = (id: string, name: string) => {
    setContactedIds((prev) => ({ ...prev, [id]: true }));
    // Open AiSensy / WhatsApp web link
    window.open(
      `https://web.whatsapp.com/send?text=${encodeURIComponent(
        `Dear ${name}, regarding your mutual fund SIP installment update from our office...`
      )}`,
      "_blank"
    );
  };

  return (
    <div className="rounded-2xl bg-card border border-border/80 shadow-xs overflow-hidden">
      {/* Card Header & Tab Switcher */}
      <div className="p-5 border-b border-border/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-secondary/20">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center size-8 rounded-lg bg-rose-500/10 text-rose-600 border border-rose-500/20">
            <AlertTriangle className="size-4" />
          </span>
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              Needs Your Attention
              <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 border border-rose-500/20">
                {rejections.length + complianceGaps.length + reviewsDue.length} Actionable
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              Direct intervention queues to protect client retention, SIP persistency, and compliance.
            </p>
          </div>
        </div>

        {/* Tab Pills */}
        <div className="flex items-center gap-1 bg-secondary/80 p-1 rounded-xl border border-border/60">
          <button
            type="button"
            onClick={() => setActiveTab("sip")}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "sip"
                ? "bg-card text-foreground shadow-2xs border border-border/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>SIP Bounces</span>
            <span className="size-4 rounded-full bg-rose-500 text-white text-2xs grid place-items-center">
              {rejections.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("compliance")}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "compliance"
                ? "bg-card text-foreground shadow-2xs border border-border/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>KYC & Nominee</span>
            <span className="size-4 rounded-full bg-amber-500 text-white text-2xs grid place-items-center">
              {complianceGaps.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("reviews")}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "reviews"
                ? "bg-card text-foreground shadow-2xs border border-border/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>Portfolio Reviews</span>
            <span className="size-4 rounded-full bg-indigo-500 text-white text-2xs grid place-items-center">
              {reviewsDue.length}
            </span>
          </button>
        </div>
      </div>

      {/* Tab Content List */}
      <div className="divide-y divide-border/60">
        {activeTab === "sip" && (
          <>
            {rejections.map((item) => {
              const contacted = contactedIds[item.id];
              return (
                <div
                  key={item.id}
                  className="p-4 sm:p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-secondary/30 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="size-9 rounded-xl bg-rose-500/10 text-rose-600 border border-rose-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Clock className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground hover:underline cursor-pointer">
                          {item.investorName}
                        </span>
                        <span className="font-mono text-xs font-bold text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded-md">
                          {formatINR(item.amount)}
                        </span>
                        <span className="text-2xs text-muted-foreground">· {item.date}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{item.schemeName}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-2xs font-medium text-amber-700 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                          Reason: {item.reason}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => handleWhatsAppClick(item.id, item.investorName)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                        contacted
                          ? "bg-emerald-500/10 text-emerald-700 border border-emerald-500/30"
                          : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs"
                      }`}
                    >
                      {contacted ? (
                        <>
                          <CheckCircle2 className="size-3.5" />
                          <span>Followed Up</span>
                        </>
                      ) : (
                        <>
                          <MessageSquare className="size-3.5" />
                          <span>1-Click WhatsApp</span>
                        </>
                      )}
                    </button>

                    <Link
                      href={`/dashboard/investors`}
                      className="p-1.5 rounded-lg border border-border/70 hover:bg-secondary text-muted-foreground hover:text-foreground"
                      title="View Investor Folios"
                    >
                      <ChevronRight className="size-4" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {activeTab === "compliance" && (
          <>
            {complianceGaps.map((item) => (
              <div
                key={item.id}
                className="p-4 sm:p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-secondary/30 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="size-9 rounded-xl bg-amber-500/10 text-amber-600 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldAlert className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{item.investorName}</span>
                      <span className="font-mono text-2xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border/60">
                        {item.pan}
                      </span>
                      <span className="text-2xs text-muted-foreground">· AUM {formatINR(item.aum)}</span>
                    </div>
                    <p className="text-xs text-rose-600 font-medium mt-0.5">{item.issue}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <Link
                    href="/dashboard/investors"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium border border-border bg-secondary hover:bg-secondary/80 text-foreground"
                  >
                    <FileCheck className="size-3.5 text-primary" />
                    <span>Send KYC Link</span>
                  </Link>
                </div>
              </div>
            ))}
          </>
        )}

        {activeTab === "reviews" && (
          <>
            {reviewsDue.map((item) => (
              <div
                key={item.id}
                className="p-4 sm:p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-secondary/30 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="size-9 rounded-xl bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Calendar className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{item.investorName}</span>
                      <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
                        {item.tier}
                      </span>
                      <span className="text-xs font-bold text-foreground">AUM {formatINR(item.aum)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Last review: {item.lastReviewDaysAgo} days ago · Managed by {item.rmName}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <Link
                    href="/dashboard/calendar"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
                  >
                    <Calendar className="size-3.5" />
                    <span>Schedule Review</span>
                  </Link>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Card Footer with Full Queue Link */}
      <div className="p-3 bg-secondary/40 border-t border-border/70 flex items-center justify-between text-xs px-5">
        <span className="text-muted-foreground">
          Auto-synced with RTA feeds, BSE Star MF, and client engagement logs.
        </span>
        <Link
          href="/dashboard/sip-rejections"
          className="font-semibold text-primary hover:underline inline-flex items-center gap-1"
        >
          View Full Triage Worklist <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
