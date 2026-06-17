/**
 * Starter message templates — vendor-provided, compliance-reviewed defaults that
 * predefined Workflow Rules reference. They're auto-provisioned per tenant when
 * a rule that uses them is activated (see ensureStarterTemplate), so an MFD can
 * turn a rule on without first hand-authoring a template.
 *
 * Pure data (no DB imports). Email bodies use the EmailTemplateBody shape the
 * email renderer understands ({subject, blocks:[{type,...}], textFallback}).
 * Tokens: {{tenant_display_name}} / {{tenant_arn}} etc. are auto-injected from
 * the tenant; record fields (e.g. {{name}}, {{referred_by_name}}) are passed by
 * the workflow-rules send action.
 */

type StarterVar = {
  key: string;
  type: "string" | "number" | "currency" | "date" | "boolean" | "url";
  source?: string;
  required?: boolean;
  fallback?: unknown;
  format?: string;
};

export interface StarterTemplate {
  key: string;
  channel: "email" | "whatsapp" | "sms";
  category: "transactional" | "utility" | "marketing" | "authentication";
  name: string;
  description?: string;
  /** EmailTemplateBody for email; channel-specific otherwise. */
  body: Record<string, unknown>;
  variables: StarterVar[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: "lead_welcome",
    channel: "email",
    category: "transactional",
    name: "Lead welcome — thank you for connecting",
    description: "Sent to a new lead with no referral.",
    body: {
      subject: "Thank you for connecting with {{tenant_display_name}}",
      blocks: [
        { type: "header", title: "Thank you for connecting 🙏" },
        {
          type: "text",
          content:
            "Hi {{name}},\n\nThank you for connecting with {{tenant_display_name}}. We're glad to have the chance to help you with your investments.\n\nOne of our advisors will reach out to you shortly to understand your goals. If you have any questions in the meantime, just reply to this email.\n\nWarm regards,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Hi {{name}}, thank you for connecting with {{tenant_display_name}}. One of our advisors will reach out to you shortly.",
    },
    variables: [{ key: "name", type: "string", source: "lead.name", fallback: "there" }],
  },
  {
    key: "lead_welcome_referral",
    channel: "email",
    category: "transactional",
    name: "Lead welcome — referred by a client",
    description: "Sent to a new lead who came from a client referral; names the referrer.",
    body: {
      subject: "Thank you for connecting with {{tenant_display_name}}",
      blocks: [
        { type: "header", title: "Thank you for connecting 🙏" },
        {
          type: "text",
          content:
            "Hi {{name}},\n\nThank you for connecting with {{tenant_display_name}} — and a special thank-you to {{referred_by_name}}, who referred you to us. We're grateful for the introduction.\n\nOne of our advisors will reach out shortly to understand your goals. Feel free to reply to this email anytime.\n\nWarm regards,\n{{tenant_display_name}}",
        },
      ],
      textFallback:
        "Hi {{name}}, thank you for connecting with {{tenant_display_name}} — and thanks to {{referred_by_name}} for referring you. An advisor will reach out shortly.",
    },
    variables: [
      { key: "name", type: "string", source: "lead.name", fallback: "there" },
      { key: "referred_by_name", type: "string", source: "lead.referred_by_name" },
    ],
  },
];

export function getStarterTemplate(key: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.key === key);
}
