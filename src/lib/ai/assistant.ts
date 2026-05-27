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
