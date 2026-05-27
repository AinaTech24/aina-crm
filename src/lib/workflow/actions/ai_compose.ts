import Anthropic from "@anthropic-ai/sdk";
import { resolveExpression } from "../context";
import type { ActionHandler } from "./index";

let anthropic: Anthropic | null = null;
function getClient() {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  }
  return anthropic;
}

/**
 * Generate text via Claude, e.g., personalized review meeting scripts,
 * compliance-aware investor communication drafts, etc.
 *
 * The result is stored in `vars.<storeAs>` for use by a subsequent
 * `send_whatsapp` or `send_email` step.
 *
 * ALL ai_compose outputs are flagged for compliance review before being
 * sent to a recipient — never auto-send AI-generated content without
 * passing through the deterministic compliance gate (see lib/comms/compliance.ts).
 */
export const aiComposeHandler: ActionHandler<any> = {
  type: "ai_compose",
  async execute(ctx, node) {
    const cfg = node.config;
    const prompt = String(resolveExpression(cfg.prompt, ctx));

    // Build context object from selected fields
    const contextSnippet: Record<string, unknown> = {};
    for (const path of cfg.context as string[]) {
      contextSnippet[path] = resolveExpression(path, ctx);
    }
    const fullPrompt =
      prompt +
      (Object.keys(contextSnippet).length
        ? `\n\nContext:\n${JSON.stringify(contextSnippet, null, 2)}`
        : "");

    const systemPrompt = [
      "You are an AI assistant for a mutual fund distributor (MFD) firm in India.",
      "All output you produce will be reviewed for AMFI/SEBI compliance before being sent.",
      "Never guarantee returns. Never recommend specific schemes without explicit instruction.",
      "Always include the mandatory market risk disclaimer when drafting marketing material.",
      "Keep tone professional and warm. Default language: English, but match the requested language.",
    ].join("\n");

    const client = getClient();
    const response = await client.messages.create({
      model: cfg.model ?? "claude-haiku-4-5-20251001",
      max_tokens: cfg.maxTokens ?? 800,
      system: systemPrompt,
      messages: [{ role: "user", content: fullPrompt }],
    });
    const textPart = response.content.find((c: any) => c.type === "text");
    const output = textPart && "text" in textPart ? (textPart as any).text : "";

    return {
      kind: "continue",
      output: { model: response.model, usage: response.usage },
      varsPatch: { [cfg.storeAs]: output },
    };
  },
};
