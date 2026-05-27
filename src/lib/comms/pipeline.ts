/**
 * Unified send pipeline. Called by workflow actions, campaign dispatchers,
 * and manual UI send actions. Routes through:
 *   1. Template + version resolution
 *   2. Variable / token rendering
 *   3. Consent check
 *   4. (WhatsApp only) session window check
 *   5. Compliance gate
 *   6. Rate limit check (per-tenant queue suffix)
 *   7. Channel adapter dispatch
 *   8. Insert communications row with full audit snapshot
 *
 * Every step is observable — the resulting communications row carries the
 * consent + compliance snapshot at send time, immutable forever.
 */

import { and, desc, eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Tx } from "@/db/client";
import {
  communications,
  consents,
  templateVersions,
  templates,
  type Consent,
  type Template,
  type TemplateVersion,
} from "@/db/schema";
import { runComplianceChecks, type ComplianceResult } from "./compliance";
import { resolveTokens, renderTemplateText, type VariableDef } from "./tokens";
import { whatsappAdapter } from "./adapters/aisensy";
import { emailAdapter } from "./adapters/resend";
import { smsAdapter } from "./adapters/msg91";

export type DispatchChannel = "whatsapp" | "email" | "sms";

export interface DispatchInput {
  tenantId: string;
  channel: DispatchChannel;
  templateKey: string;
  recipient: string;
  variables: Record<string, unknown>;
  category: "transactional" | "utility" | "marketing" | "authentication";
  investorId?: string;
  leadId?: string;
  workflowRunId?: string;
  workflowRunStepId?: string;
  campaignId?: string;
  meta?: Record<string, unknown>;
  /** Allow caller to override the locale */
  locale?: string;
  /** Bypass consent check — only allowed for AUTHENTICATION/OTP category */
  bypassConsent?: boolean;
}

export interface DispatchResult {
  communicationId: string;
  status: "sent" | "queued" | "skipped";
  externalId?: string;
  skipped?: { reason: string; findings?: ComplianceResult["findings"] };
}

export async function dispatch(tx: Tx, input: DispatchInput): Promise<DispatchResult> {
  const communicationId = uuid();
  // -----------------------------------------------------------
  // 1. Resolve template + version
  // -----------------------------------------------------------
  const [tmpl] = await tx
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.tenantId, input.tenantId),
        eq(templates.key, input.templateKey),
        eq(templates.channel, input.channel),
        eq(templates.locale, input.locale ?? "en-IN")
      )
    );
  if (!tmpl) {
    throw new Error(`Template '${input.templateKey}' (${input.channel}) not found`);
  }
  if (tmpl.status !== "approved") {
    return await skip(tx, communicationId, input, "template_not_approved");
  }
  if (!tmpl.currentVersionId) {
    throw new Error(`Template '${input.templateKey}' has no current version`);
  }
  const [version] = await tx
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.id, tmpl.currentVersionId));
  if (!version) {
    throw new Error("Template version missing");
  }

  // -----------------------------------------------------------
  // 2. Render — resolve typed tokens
  // -----------------------------------------------------------
  const tenantRow = await loadTenant(tx, input.tenantId);
  const subject = input.investorId ? await loadInvestor(tx, input.investorId) : null;
  let rendered: { text: string; subject?: string; tokens: Record<string, string> };
  try {
    const tokens = resolveTokens(version.variables as VariableDef[], {
      tenant: tenantRow,
      subject,
      context: input.meta,
      overrides: input.variables as Record<string, any>,
    });
    rendered = renderBody(input.channel, version, tokens);
  } catch (err) {
    return await skip(
      tx,
      communicationId,
      input,
      "render_error",
      `Variable resolution failed: ${(err as Error).message}`
    );
  }

  // -----------------------------------------------------------
  // 3. Consent check
  // -----------------------------------------------------------
  let consentSnapshot: Consent | null = null;
  if (input.investorId && !input.bypassConsent && input.category !== "authentication") {
    const consentRow = await getConsent(
      tx,
      input.tenantId,
      input.investorId,
      input.channel,
      input.category === "marketing" ? "marketing" : "transactional"
    );
    if (!consentRow || consentRow.status !== "granted") {
      return await skip(tx, communicationId, input, "skipped_consent");
    }
    consentSnapshot = consentRow;
  }

  // -----------------------------------------------------------
  // 4. WhatsApp session window
  // -----------------------------------------------------------
  let sessionActive = false;
  if (input.channel === "whatsapp" && input.investorId) {
    sessionActive = await hasActiveWhatsappSession(tx, input.tenantId, input.investorId);
  }

  // -----------------------------------------------------------
  // 5. Compliance gate
  // -----------------------------------------------------------
  const compliance = runComplianceChecks({
    channel: input.channel,
    category: input.category,
    tenant: {
      legalName: tenantRow?.legalName,
      arn: tenantRow?.arn,
      principalEuin: tenantRow?.principalEuin ?? undefined,
      riaRegistered: tenantRow?.riaRegistered ?? false,
    },
    text: rendered.text,
    subject: rendered.subject,
    dltTemplateId: input.channel === "sms" ? extractDltId(version) : undefined,
    whatsappSessionActive: sessionActive,
    hasMarketingConsent: input.category === "marketing" ? !!consentSnapshot : true,
    amcApprovalRef: (version.body as any)?.amcApprovalRef,
  });

  if (compliance.blocked) {
    return await skip(tx, communicationId, input, "skipped_compliance", JSON.stringify(compliance.findings), compliance);
  }

  // -----------------------------------------------------------
  // 6. Pre-insert communications row (status='queued') for audit
  // -----------------------------------------------------------
  await tx.insert(communications).values({
    id: communicationId,
    tenantId: input.tenantId,
    investorId: input.investorId,
    leadId: input.leadId,
    channel: input.channel,
    direction: "outbound",
    templateVersionId: version.id,
    templateKey: input.templateKey,
    status: "queued",
    payload: {
      rendered,
      variables: rendered.tokens,
      meta: input.meta,
    } as any,
    workflowRunId: input.workflowRunId,
    workflowRunStepId: input.workflowRunStepId,
    campaignId: input.campaignId,
    consentSnapshot: consentSnapshot as any,
    complianceSnapshot: compliance.findings as any,
    complianceScore: String(compliance.score) as any,
    queuedAt: new Date(),
  });

  // -----------------------------------------------------------
  // 7. Channel dispatch (adapter)
  // -----------------------------------------------------------
  try {
    let adapterResult: { externalId: string; status: "sent" | "queued" };
    if (input.channel === "whatsapp") {
      adapterResult = await whatsappAdapter.send({
        tenantId: input.tenantId,
        templateVersion: version,
        tokens: rendered.tokens,
        recipient: input.recipient,
      });
    } else if (input.channel === "email") {
      adapterResult = await emailAdapter.send({
        tenantId: input.tenantId,
        templateVersion: version,
        tokens: rendered.tokens,
        rendered,
        recipient: input.recipient,
        category: input.category as any,
        cc: (input.meta?.cc as string[]) ?? [],
        bcc: (input.meta?.bcc as string[]) ?? [],
      });
    } else {
      adapterResult = await smsAdapter.send({
        tenantId: input.tenantId,
        templateVersion: version,
        tokens: rendered.tokens,
        rendered,
        recipient: input.recipient,
      });
    }
    await tx
      .update(communications)
      .set({
        externalId: adapterResult.externalId,
        status: adapterResult.status,
        sentAt: new Date(),
      })
      .where(eq(communications.id, communicationId));

    return {
      communicationId,
      status: adapterResult.status,
      externalId: adapterResult.externalId,
    };
  } catch (err) {
    await tx
      .update(communications)
      .set({
        status: "failed",
        statusReason: (err as Error).message,
        failedAt: new Date(),
      })
      .where(eq(communications.id, communicationId));
    throw err;
  }
}

async function skip(
  tx: Tx,
  id: string,
  input: DispatchInput,
  reason:
    | "skipped_consent"
    | "skipped_compliance"
    | "skipped_session"
    | "skipped_rate_limit"
    | "template_not_approved"
    | "render_error",
  detail?: string,
  compliance?: ComplianceResult
): Promise<DispatchResult> {
  await tx.insert(communications).values({
    id,
    tenantId: input.tenantId,
    investorId: input.investorId,
    leadId: input.leadId,
    channel: input.channel,
    direction: "outbound",
    templateKey: input.templateKey,
    status: reason.startsWith("skipped_") ? (reason as any) : "failed",
    statusReason: detail ?? reason,
    complianceSnapshot: compliance?.findings as any,
    workflowRunId: input.workflowRunId,
    workflowRunStepId: input.workflowRunStepId,
    campaignId: input.campaignId,
  });
  return { communicationId: id, status: "skipped", skipped: { reason, findings: compliance?.findings } };
}

function renderBody(
  channel: DispatchChannel,
  version: TemplateVersion,
  tokens: Record<string, string>
) {
  const body = version.body as any;
  if (channel === "whatsapp") {
    const headerText = body.header?.text ?? "";
    const footerText = body.footer?.text ?? "";
    const bodyText = body.body?.text ?? "";
    const text = [headerText, bodyText, footerText].filter(Boolean).map((t) => renderTemplateText(t, tokens)).join("\n\n");
    return { text, tokens };
  }
  if (channel === "email") {
    // New designer-mode body — extract text via the new renderer's helper so
    // the plain-text fallback covers raw HTML mode + new block types.
    if (body?.mode === "designer" || body?.mode === "html") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { renderEmailText } = require("@/lib/email-designer/render") as typeof import("@/lib/email-designer/render");
      const text = renderEmailText(body, { variables: unflattenForText(tokens) });
      return {
        subject: renderTemplateText(body.subject ?? "", tokens),
        text: renderTemplateText(text, tokens),
        tokens,
      };
    }
    return {
      subject: renderTemplateText(body.subject ?? "", tokens),
      text: renderTemplateText(body.textFallback ?? extractTextFromBlocks(body), tokens),
      tokens,
    };
  }
  if (channel === "sms") {
    return { text: renderTemplateText(body.text ?? "", tokens), tokens };
  }
  return { text: "", tokens };
}

function extractTextFromBlocks(body: any): string {
  if (!body?.blocks) return "";
  return body.blocks
    .map((b: any) => {
      if (b.type === "text") return b.content ?? "";
      if (b.type === "header") return b.title ?? "";
      if (b.type === "button") return b.label ?? "";
      return "";
    })
    .join("\n\n");
}

function unflattenForText(tokens: Record<string, string>): Record<string, unknown> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(tokens ?? {})) {
    if (!k.includes("_")) {
      out[k] = v;
      continue;
    }
    const idx = k.indexOf("_");
    const ns = k.slice(0, idx);
    const rest = k.slice(idx + 1);
    out[ns] ??= {};
    out[ns][rest] = v;
    out[k] = v;
  }
  return out;
}

function extractDltId(version: TemplateVersion): string | undefined {
  const body = version.body as any;
  return body?.dltTemplateId;
}

// ---------------------------------------------------------------------------
// Small helpers — local imports kept off the hot path
// ---------------------------------------------------------------------------

async function loadTenant(tx: Tx, tenantId: string) {
  const { tenants } = await import("@/db/schema");
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  return t;
}
async function loadInvestor(tx: Tx, id: string) {
  const { investors } = await import("@/db/schema");
  const [i] = await tx.select().from(investors).where(eq(investors.id, id));
  return i ?? null;
}
async function getConsent(
  tx: Tx,
  tenantId: string,
  investorId: string,
  channel: string,
  scope: "transactional" | "marketing"
) {
  const [c] = await tx
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.tenantId, tenantId),
        eq(consents.investorId, investorId),
        eq(consents.channel, channel as any),
        eq(consents.scope, scope as any)
      )
    );
  return c ?? null;
}
async function hasActiveWhatsappSession(tx: Tx, tenantId: string, investorId: string): Promise<boolean> {
  const [row] = await tx
    .select()
    .from(communications)
    .where(
      and(
        eq(communications.tenantId, tenantId),
        eq(communications.investorId, investorId),
        eq(communications.channel, "whatsapp"),
        eq(communications.direction, "inbound")
      )
    )
    .orderBy(desc(communications.createdAt))
    .limit(1);
  if (!row?.createdAt) return false;
  const elapsed = Date.now() - new Date(row.createdAt).getTime();
  return elapsed < 24 * 60 * 60 * 1000;
}
