/**
 * Compliance + consent gate for AD-HOC client sends that don't go through the
 * template-based dispatch() pipeline — proposals, portfolio statements, and
 * service-request acknowledgements render bespoke HTML, so they can't resolve a
 * stored template. They must NOT therefore skip the regulatory gate.
 *
 * gateClientSend() runs the SAME compliance checker dispatch() uses (so the
 * guaranteed/assured-return + adviser-term + ARN scans apply) and the SAME
 * consent semantics, returning the snapshots the caller persists on its
 * `communications` row. Callers keep their own send + audit logic.
 *
 * Consent: the one rule every send uses (lib/comms/consent-rule) — an opt-out
 * blocks, marketing needs a GRANTED row, transactional / utility is allowed
 * otherwise. The snapshot is recorded either way.
 */
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { consents, tenants } from "@/db/schema";
import { runComplianceChecks, type ComplianceFinding } from "./compliance";
import { consentDecision } from "./consent-rule";

export type GateChannel = "email" | "whatsapp" | "sms";
export type GateCategory = "transactional" | "utility" | "marketing";

export type ClientSendGate =
  | {
      allowed: true;
      complianceFindings: ComplianceFinding[];
      complianceScore: number;
      consentSnapshot: any | null;
    }
  | {
      allowed: false;
      reason: "compliance_blocked" | "consent_missing";
      detail: string;
      findings?: ComplianceFinding[];
    };

export async function gateClientSend(
  tx: Tx,
  args: {
    tenantId: string;
    channel: GateChannel;
    category: GateCategory;
    /** Rendered body (HTML or text) to scan for compliance. */
    text: string;
    subject?: string;
    /** Consent is only enforceable when the recipient is a known investor. */
    investorId?: string | null;
  }
): Promise<ClientSendGate> {
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, args.tenantId)).limit(1);
  const tenant = t as any;

  // ── Consent ────────────────────────────────────────────────────────────
  let consentSnapshot: any | null = null;
  if (args.investorId) {
    const scope = args.category === "marketing" ? "marketing" : "transactional";
    const [c] = await tx
      .select()
      .from(consents)
      .where(
        and(
          eq(consents.tenantId, args.tenantId),
          eq(consents.investorId, args.investorId),
          eq(consents.channel, args.channel as any),
          eq(consents.scope, scope as any)
        )
      )
      .limit(1);
    consentSnapshot = c ?? null;
    const decision = consentDecision(args.category, c ?? null, args.channel);
    if (decision.blocked) {
      return { allowed: false, reason: "consent_missing", detail: decision.message };
    }
  }

  // ── Compliance ─────────────────────────────────────────────────────────
  const compliance = runComplianceChecks({
    channel: args.channel === "sms" ? "sms" : args.channel,
    category: args.category,
    tenant: {
      legalName: tenant?.legalName,
      arn: tenant?.arn,
      principalEuin: tenant?.principalEuin ?? undefined,
      riaRegistered: tenant?.riaRegistered ?? false,
    },
    text: args.text,
    subject: args.subject,
    // Solicited 1:1 documents — not WhatsApp-template-gated.
    whatsappSessionActive: true,
    hasMarketingConsent: args.category === "marketing" ? !!consentSnapshot : true,
  });
  if (compliance.blocked) {
    return {
      allowed: false,
      reason: "compliance_blocked",
      detail: compliance.findings.filter((f) => f.severity === "block").map((f) => f.message).join("; "),
      findings: compliance.findings,
    };
  }

  return {
    allowed: true,
    complianceFindings: compliance.findings,
    complianceScore: compliance.score,
    consentSnapshot,
  };
}
