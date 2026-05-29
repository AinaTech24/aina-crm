/**
 * AI Assistant — Tier 1 (smart search + draft assist).
 *
 * Two capabilities:
 *   1. NL → FilterAST: "Show me HNI clients in Mumbai with no contact in
 *      60 days" → produces a valid FilterAST that compiles against the
 *      catalog. The compiler is the safety net — anything the model
 *      hallucinates that isn't in the catalog gets rejected.
 *
 *   2. Draft assist: in template designer, "make this warmer" or "add a
 *      mandate-failure CTA" returns updated text. Output passes through the
 *      same compliance gate before showing — model never bypasses rules.
 */

import Anthropic from "@anthropic-ai/sdk";
import { FilterASTSchema, type FilterAST } from "@/lib/filter/ast";
import { CATALOGS } from "@/lib/filter/catalog";

const FAST_MODEL = process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5-20251001";
const REASONING_MODEL = process.env.ANTHROPIC_MODEL_REASONING ?? "claude-opus-4-7";

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Convert a natural-language query into a FilterAST.
 */
export async function nlToFilterAst(
  query: string,
  subject: "investor" | "lead" | "task"
): Promise<{ ast: FilterAST; explanation: string } | { error: string }> {
  const catalog = CATALOGS[subject];
  const fieldSummary = catalog.fields
    .map((f) => `  - ${f.key} (${f.type}): ${f.label}`)
    .join("\n");

  const systemPrompt = `You translate natural-language queries about ${subject}s into a JSON FilterAST.

The AST schema:
  {
    "type": "group",
    "op": "AND" | "OR",
    "not"?: boolean,
    "children": [ ...predicates or nested groups ]
  }

A predicate:
  {
    "type": "predicate",
    "field": { "kind": "attr", "path": "<field_key>" },
    "op": "<operator>",
    "value": <value>,
    "duration"?: { "amount": <number>, "unit": "day"|"week"|"month"|"year" }
  }

Operators: eq, ne, gt, gte, lt, lte, contains, starts_with, ends_with, in, not_in,
between, is_null, is_not_null, is_empty, is_not_empty, is_true, is_false,
date_within, date_before, date_after, date_in_next, date_in_last, date_today,
date_yesterday, date_tomorrow, date_is_anniversary

For date_within / date_in_next / date_in_last, also provide a "duration" object.

Available fields on ${subject}:
${fieldSummary}

CRITICAL: Use only field keys from the list above. Do not invent fields.
Output ONLY the JSON AST — no markdown, no explanation.`;

  try {
    const result = await client().messages.create({
      model: FAST_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: query }],
    });
    const text = result.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    // Strip code-fence if model added one
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json);
    const ast = FilterASTSchema.safeParse(parsed);
    if (!ast.success) {
      return { error: `Generated AST failed schema validation: ${ast.error.issues.map((i) => i.message).join("; ")}` };
    }
    return { ast: ast.data, explanation: `Translated to ${subject} filter.` };
  } catch (err: any) {
    return { error: err.message ?? "AI error" };
  }
}

/**
 * Draft a message in template designer.
 * Returns text — caller is responsible for running compliance gate before showing.
 */
export async function draftMessage(params: {
  channel: "whatsapp" | "email" | "sms";
  intent: string;
  audienceContext?: string;
  variables?: string[];
}): Promise<{ text: string } | { error: string }> {
  const variableHint = params.variables?.length
    ? `Use these variables as {{key}}: ${params.variables.join(", ")}`
    : "Use {{name}} for the recipient name.";

  const systemPrompt = `You draft compliance-safe ${params.channel} messages for Indian Mutual Fund Distributors.

Rules:
- NEVER promise returns ("guaranteed", "assured", "X% returns")
- NEVER recommend a specific scheme (AMFI Code of Conduct 4(k))
- DO end with the mandatory line: "Mutual fund investments are subject to market risks. Read all scheme related documents carefully."
- DO mention "ARN-{{arn_no}}" and the firm name
- Keep it warm but professional. Indian context.

${variableHint}

Output ONLY the message text — no explanations.`;

  try {
    const result = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: params.intent }],
    });
    const text = result.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return { text };
  } catch (err: any) {
    return { error: err.message ?? "AI error" };
  }
}

/* ============================================================================
 * Sprint 2 — AI quick wins
 * ============================================================================
 * Five MFD-specific helpers that wrap Claude with carefully constrained
 * prompts. Each returns either a structured payload or { error }. None of
 * them write to the DB — callers persist the result if the RM accepts it.
 * That keeps AI advisory (not authoritative) and avoids audit-trail blur.
 */

/**
 * Summarise a review meeting from raw RM notes.
 * Returns key points / decisions / action items / next steps.
 */
export async function summariseMeeting(params: {
  notes: string;
  agenda?: string;
  meetingType?: string;
  durationMinutes?: number;
  clientName?: string;
}): Promise<
  | {
      summary: string;
      keyPoints: string[];
      decisions: string[];
      actionItems: Array<{ title: string; owner?: string; dueHint?: string }>;
      nextSteps: string[];
    }
  | { error: string }
> {
  const ctx = [
    params.clientName ? `Client: ${params.clientName}` : null,
    params.meetingType ? `Type: ${params.meetingType}` : null,
    params.durationMinutes ? `Duration: ${params.durationMinutes} min` : null,
    params.agenda ? `Pre-meeting agenda:\n${params.agenda}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You summarise client review meetings for Indian Mutual Fund Distributors.

Output a JSON object with this exact shape:
{
  "summary": "2-3 sentence executive summary",
  "keyPoints": ["bullet…", "bullet…"],
  "decisions": ["client agreed to X", …],
  "actionItems": [{ "title": "…", "owner": "RM|Client|Ops", "dueHint": "this week|next month|…" }],
  "nextSteps": ["follow up in 30 days on Y", …]
}

Rules:
- NEVER invent facts the notes don't support.
- NEVER recommend a specific scheme (AMFI 4(k)).
- Keep each bullet under 18 words.
- If the notes are too thin to extract a section, return an empty array for it.
- Output ONLY the JSON object — no markdown, no preamble.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1500,
      system,
      messages: [
        {
          role: "user",
          content: `${ctx}\n\nMeeting notes:\n${params.notes}`,
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json);
    // Light defensive coercion
    return {
      summary: String(parsed.summary ?? ""),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String) : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(String) : [],
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems
            .filter((a: any) => a && typeof a === "object" && a.title)
            .map((a: any) => ({
              title: String(a.title),
              owner: a.owner ? String(a.owner) : undefined,
              dueHint: a.dueHint ? String(a.dueHint) : undefined,
            }))
        : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String) : [],
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Score a lead 0-100 based on observed engagement + profile signals.
 * Returns score + hot/warm/cold band + 1-2 sentence reasoning + suggested
 * next action. Deterministic in that we instruct the model to be
 * conservative — bandable signal beats a confident hunch.
 */
export async function scoreLead(params: {
  name: string;
  source?: string;
  stage?: string;
  ageInStageDays?: number;
  lastTouchDaysAgo?: number;
  callsCount?: number;
  meetingsCount?: number;
  emailOpens?: number;
  whatsappReplies?: number;
  estimatedAumInr?: number;
  notes?: string;
}): Promise<
  | {
      score: number;
      band: "hot" | "warm" | "cold";
      reasoning: string;
      nextAction: string;
    }
  | { error: string }
> {
  const sig = [
    `Name: ${params.name}`,
    params.source ? `Source: ${params.source}` : null,
    params.stage ? `Stage: ${params.stage}` : null,
    params.ageInStageDays != null ? `Age in stage: ${params.ageInStageDays} days` : null,
    params.lastTouchDaysAgo != null ? `Last touch: ${params.lastTouchDaysAgo} days ago` : null,
    params.callsCount != null ? `Calls: ${params.callsCount}` : null,
    params.meetingsCount != null ? `Meetings: ${params.meetingsCount}` : null,
    params.emailOpens != null ? `Email opens: ${params.emailOpens}` : null,
    params.whatsappReplies != null ? `WhatsApp replies: ${params.whatsappReplies}` : null,
    params.estimatedAumInr != null
      ? `Est. AUM: ₹${Math.round(params.estimatedAumInr).toLocaleString("en-IN")}`
      : null,
    params.notes ? `Notes:\n${params.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You score Indian MFD leads conservatively.

Output a JSON object with this exact shape:
{
  "score": <integer 0-100>,
  "band": "hot" | "warm" | "cold",
  "reasoning": "1-2 sentences citing the specific signals",
  "nextAction": "single concrete action the RM should take next"
}

Band guidance:
  hot   = score >= 70 (strong engagement, recent touch, real intent signal)
  warm  = 40-69 (some signal, needs nurture)
  cold  = < 40 (stale, low signal — recommend re-qualify or close)

Penalise: long time-in-stage with no movement, > 30 days no touch, zero replies.
Reward: meeting attended, WhatsApp replies, high estimated AUM, fresh referral source.
Never invent signals. If data is missing, score conservatively (closer to cold).
Output ONLY the JSON object.`;

  try {
    const res = await client().messages.create({
      model: FAST_MODEL,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: sig }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json);
    const rawScore = Number(parsed.score ?? 0);
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const band: "hot" | "warm" | "cold" =
      parsed.band === "hot" || parsed.band === "warm" || parsed.band === "cold"
        ? parsed.band
        : score >= 70
          ? "hot"
          : score >= 40
            ? "warm"
            : "cold";
    return {
      score,
      band,
      reasoning: String(parsed.reasoning ?? ""),
      nextAction: String(parsed.nextAction ?? ""),
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Generate 3 campaign concepts for a given segment.
 */
export async function generateCampaignIdeas(params: {
  segmentName: string;
  subject: "investor" | "lead";
  segmentDescription?: string;
  sampleSize?: number;
  fieldsSummary?: string;
}): Promise<
  | {
      ideas: Array<{
        title: string;
        objective: string;
        channels: Array<"whatsapp" | "email" | "sms">;
        tone: string;
        suggestedTriggers: string[];
        sampleMessage: string;
      }>;
    }
  | { error: string }
> {
  const ctx = [
    `Segment: ${params.segmentName} (${params.subject}s)`,
    params.segmentDescription ? `Description: ${params.segmentDescription}` : null,
    params.sampleSize != null ? `Audience size: ${params.sampleSize}` : null,
    params.fieldsSummary ? `Notable shared traits:\n${params.fieldsSummary}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You propose marketing campaign concepts for Indian Mutual Fund Distributors.

Output a JSON object with this exact shape:
{
  "ideas": [
    {
      "title": "short campaign name",
      "objective": "what this campaign achieves",
      "channels": ["whatsapp" | "email" | "sms"],
      "tone": "warm | educational | urgent | celebratory",
      "suggestedTriggers": ["event or schedule that fires this"],
      "sampleMessage": "1-2 line sample copy (NO scheme names, NO return promises)"
    }
  ]
}

Rules:
- Exactly 3 ideas. Diverse — don't propose 3 variants of the same thing.
- NEVER promise returns or recommend specific schemes.
- Always end sampleMessage with the standard mutual-fund risk disclosure (abbreviated is fine).
- Channels: choose what fits the objective — utility/reminder = whatsapp, education = email, urgent = sms.
- Output ONLY the JSON object.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: ctx }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    const json = text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(json);
    const ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
    return {
      ideas: ideas
        .filter((i: any) => i && typeof i === "object" && i.title)
        .map((i: any) => ({
          title: String(i.title),
          objective: String(i.objective ?? ""),
          channels: Array.isArray(i.channels)
            ? i.channels.filter((c: any) =>
                ["whatsapp", "email", "sms"].includes(c)
              )
            : [],
          tone: String(i.tone ?? "warm"),
          suggestedTriggers: Array.isArray(i.suggestedTriggers)
            ? i.suggestedTriggers.map(String)
            : [],
          sampleMessage: String(i.sampleMessage ?? ""),
        })),
    };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Draft a DDQ (Due Diligence Questionnaire) answer for a single question.
 * The MFD reviews + accepts; AI never auto-submits to the DDQ vault.
 */
export async function draftDdqAnswer(params: {
  question: string;
  tenantProfile: {
    displayName: string;
    arn?: string | null;
    euin?: string | null;
    aumRange?: string | null;
    teamSize?: string | null;
    address?: any;
  };
  existingAnswerHint?: string;
}): Promise<{ draft: string } | { error: string }> {
  const profile = [
    `Firm: ${params.tenantProfile.displayName}`,
    params.tenantProfile.arn ? `ARN: ${params.tenantProfile.arn}` : null,
    params.tenantProfile.euin ? `EUIN: ${params.tenantProfile.euin}` : null,
    params.tenantProfile.aumRange ? `AUM range: ${params.tenantProfile.aumRange}` : null,
    params.tenantProfile.teamSize ? `Team size: ${params.tenantProfile.teamSize}` : null,
    params.existingAnswerHint
      ? `Prior answer / hint:\n${params.existingAnswerHint}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You draft Due Diligence Questionnaire (DDQ) answers for an Indian MFD.

Rules:
- Factual, formal, audit-grade tone. No marketing fluff.
- NEVER invent regulatory registrations the firm doesn't have.
- If you don't know a number, say "to be confirmed by compliance" — don't fabricate.
- Cite real frameworks where appropriate: SEBI (Investment Advisers) Regulations 2013, AMFI Code of Conduct, PMLA 2002, IT Act 2000.
- Keep answers under 200 words unless the question is multi-part.
- Output ONLY the answer text — no question echo, no preamble.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1500,
      system,
      messages: [
        {
          role: "user",
          content: `${profile}\n\nQuestion:\n${params.question}`,
        },
      ],
    });
    const draft = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return { draft };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}

/**
 * Generate 1-page Quarterly Review Report (QRR) commentary for an investor.
 */
export async function generateQrrCommentary(params: {
  investorName: string;
  riskProfile?: string | null;
  totalAumInr?: number | null;
  totalSipInr?: number | null;
  recentTransactions?: Array<{
    date: string;
    type: string;
    schemeCategory?: string;
    amount?: number;
  }>;
  lastReviewNotes?: string | null;
  marketContext?: string;
}): Promise<{ commentary: string } | { error: string }> {
  const ctx = [
    `Investor: ${params.investorName}`,
    params.riskProfile ? `Risk profile: ${params.riskProfile}` : null,
    params.totalAumInr != null
      ? `Total AUM: ₹${Math.round(params.totalAumInr).toLocaleString("en-IN")}`
      : null,
    params.totalSipInr != null
      ? `Monthly SIP: ₹${Math.round(params.totalSipInr).toLocaleString("en-IN")}`
      : null,
    params.recentTransactions?.length
      ? `Recent transactions:\n${params.recentTransactions
          .slice(0, 10)
          .map(
            (t) =>
              `  ${t.date} · ${t.type} · ${t.schemeCategory ?? "—"} · ₹${
                t.amount != null ? Math.round(t.amount).toLocaleString("en-IN") : "—"
              }`
          )
          .join("\n")}`
      : null,
    params.lastReviewNotes ? `Last review notes:\n${params.lastReviewNotes}` : null,
    params.marketContext ? `Market context:\n${params.marketContext}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You draft 1-page Quarterly Review Report (QRR) commentary for Indian MFD clients.

Structure:
  Paragraph 1 — portfolio overview (AUM, SIP cadence, asset-class mix at a high level)
  Paragraph 2 — period activity (recent additions/withdrawals, what changed)
  Paragraph 3 — outlook + suggested next step for the upcoming quarter

Rules:
- 250-400 words total. No bullet lists — flowing prose.
- NEVER recommend a specific scheme by name (AMFI 4(k)).
- NEVER project returns or use words like "guaranteed", "assured", "X%".
- End with: "Mutual fund investments are subject to market risks. Read all scheme related documents carefully."
- Warm professional tone, addressed to "you" / "your portfolio".
- Output ONLY the commentary — no headings, no markdown.`;

  try {
    const res = await client().messages.create({
      model: REASONING_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: ctx }],
    });
    const commentary = res.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return { commentary };
  } catch (err: any) {
    return { error: err?.message ?? "AI error" };
  }
}
