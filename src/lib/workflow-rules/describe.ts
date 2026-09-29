/**
 * Say what an automation does in plain English, for the Automations list:
 *
 *   When  "When a lead is created" · "3 days before a client's Next Review Date"
 *   Does  "Sends email “Welcome” · Creates task “Call the client”"
 *
 * and flag rules whose names look like tests ("frew", "Send mail") or say one
 * thing while the rule watches another ("…Client is Deleted" on Leads).
 *
 * Plain module (no DB, no React). Template names are looked up by the caller
 * and passed in, keyed "<channel>:<templateKey>".
 */
import { MODULES, getField } from "./modules";

/** How a record of each module is named in a sentence. */
const NOUN: Record<string, string> = {
  leads: "lead",
  investors: "client",
  families: "family",
  tasks: "task",
  transactions: "transaction",
  sips: "SIP",
  sip_rejections: "SIP rejection",
  service_requests: "service request",
  complaints: "complaint",
  review_meetings: "meeting",
  proposals: "proposal",
  insurance: "insurance policy",
  content_posts: "social post",
  campaigns: "campaign",
  goals: "goal",
  onboarding: "onboarding",
  risk_profiles: "risk profile",
  business_entries: "business entry",
};

export function moduleNoun(moduleKey: string): string {
  return NOUN[moduleKey] ?? (MODULES as Record<string, { label: string }>)[moduleKey]?.label?.toLowerCase() ?? "record";
}

const article = (noun: string) => (/^[aeiou]/i.test(noun) && !/^(u[bcfhjkqrstn]|uni)/i.test(noun) ? "an" : "a");
const withArticle = (noun: string) => `${article(noun)} ${noun}`;

function fieldName(moduleKey: string, key: unknown): string {
  const k = String(key ?? "");
  return getField(moduleKey, k)?.label ?? k.replace(/_/g, " ");
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

type RuleLike = {
  module: string;
  triggerType: string;
  triggerConfig: unknown;
  instantActions?: unknown;
  scheduledActions?: unknown;
  branches?: unknown;
};

export function describeWhen(rule: RuleLike): string {
  const noun = moduleNoun(rule.module);
  const a = withArticle(noun);
  const c = (rule.triggerConfig ?? {}) as Record<string, unknown>;
  switch (rule.triggerType) {
    case "record_action": {
      const fields = Array.isArray(c.fields) ? (c.fields as unknown[]).map((f) => fieldName(rule.module, f)) : [];
      switch (c.when) {
        case "create":
          return `When ${a} is created`;
        case "edit":
          return fields.length ? `When ${a}'s ${list(fields)} is edited` : `When ${a} is edited`;
        case "create_or_edit":
          return `When ${a} is created or edited`;
        case "delete":
          return `When ${a} is deleted`;
        case "field_update":
          return fields.length ? `When ${a}'s ${list(fields)} changes` : `When ${a} is updated`;
        default:
          return `When ${a} changes`;
      }
    }
    case "date_field": {
      const field = fieldName(rule.module, c.field);
      const offset = Number(c.offset ?? 0);
      const unit = String(c.unit ?? "day");
      const span = `${offset} ${unit}${offset === 1 ? "" : "s"}`;
      const when =
        c.when === "before" && offset > 0 ? `${span} before ${a}'s ${field}` : c.when === "after" && offset > 0 ? `${span} after ${a}'s ${field}` : `On ${a}'s ${field}`;
      const every = c.recurrence === "every_year" ? ", every year" : c.recurrence === "every_month" ? ", every month" : "";
      return `${when}${every}`;
    }
    case "score_change": {
      const field = fieldName(rule.module, c.field);
      const dir = c.direction === "increase" ? "goes up" : c.direction === "decrease" ? "goes down" : "changes";
      return `When ${a}'s ${field} ${dir}`;
    }
    case "note":
      return c.when === "deleted" ? `When a note on ${a} is deleted` : c.when === "modified" ? `When a note on ${a} is edited` : `When a note is added to ${a}`;
    case "recurrence":
      return "On a repeating schedule";
    case "recommendation":
      return `Around ${a}'s recommendation date`;
    case "competitor":
      return `When a competitor is mentioned on ${a}`;
    default:
      return `When ${a} changes`;
  }
}

type Action = { type?: string; label?: string; config?: Record<string, unknown>; delay?: { amount?: number; unit?: string } };

function actionsOf(rule: RuleLike): Array<Action & { scheduled: boolean }> {
  const sets = [
    { instant: rule.instantActions, scheduled: rule.scheduledActions },
    ...(Array.isArray(rule.branches) ? (rule.branches as Array<Record<string, unknown>>).map((b) => ({ instant: b.instantActions, scheduled: b.scheduledActions })) : []),
  ];
  const out: Array<Action & { scheduled: boolean }> = [];
  for (const s of sets) {
    for (const a of (Array.isArray(s.instant) ? s.instant : []) as Action[]) out.push({ ...a, scheduled: false });
    for (const a of (Array.isArray(s.scheduled) ? s.scheduled : []) as Action[]) out.push({ ...a, scheduled: true });
  }
  return out;
}

function quote(s: unknown): string {
  const t = String(s ?? "").trim();
  return t ? `“${t.length > 40 ? `${t.slice(0, 39)}…` : t}”` : "";
}

function describeAction(a: Action, templateName: (channel: string, key: string) => string | undefined): string {
  const c = a.config ?? {};
  const tpl = (channel: string) => {
    const key = String(c.templateKey ?? "");
    if (!key) return "(no template chosen)";
    return quote(templateName(channel, key) ?? key.replace(/_/g, " "));
  };
  switch (a.type) {
    case "send_email":
      return `Sends email ${tpl("email")}`;
    case "send_whatsapp":
      return `Sends WhatsApp ${tpl("whatsapp")}`;
    case "send_sms":
      return `Sends SMS ${tpl("sms")}`;
    case "create_task":
      return c.title ? `Creates task ${quote(c.title)}` : "Creates a task";
    case "schedule_call":
      return "Schedules a call";
    case "schedule_meeting":
      return "Schedules a meeting";
    case "update_field": {
      const n = Object.keys((c.updates ?? {}) as Record<string, unknown>).length;
      return n === 1 ? "Updates a field" : `Updates ${n} fields`;
    }
    case "add_tag":
      return c.tag ? `Adds tag ${quote(c.tag)}` : "Adds a tag";
    case "remove_tag":
      return c.tag ? `Removes tag ${quote(c.tag)}` : "Removes a tag";
    case "webhook":
      return "Calls an external system (webhook)";
    case "create_notification":
      return c.title ? `Notifies the team ${quote(c.title)}` : "Notifies the team";
    case "convert_lead":
      return "Converts the lead into a client";
    case "create_record":
      return "Creates a record";
    case "custom_function":
      return "Runs a custom function";
    default:
      return a.label ? String(a.label) : "Runs an action";
  }
}

/** Every action, in order, each with its delay when scheduled. */
export function describeDoes(rule: RuleLike, templateName: (channel: string, key: string) => string | undefined): string[] {
  return actionsOf(rule).map((a) => {
    const base = describeAction(a, templateName);
    if (!a.scheduled || !a.delay) return base;
    const n = Number(a.delay.amount ?? 0);
    const unit = String(a.delay.unit ?? "day");
    return n > 0 ? `${base} after ${n} ${unit}${n === 1 ? "" : "s"}` : base;
  });
}

/** Template keys (by channel) a rule's actions use — for one name lookup. */
export function templateRefs(rule: RuleLike): Array<{ channel: string; key: string }> {
  const channelOf: Record<string, string> = { send_email: "email", send_whatsapp: "whatsapp", send_sms: "sms" };
  return actionsOf(rule)
    .filter((a) => channelOf[a.type ?? ""] && a.config?.templateKey)
    .map((a) => ({ channel: channelOf[a.type!], key: String(a.config!.templateKey) }));
}

export const RULE_NAME_MIN = 5;

// Not "demo" or "sample": "Book a demo call" is a real automation.
const TEST_WORDS = /\b(test|testing|tst|dummy|asdf|qwerty|untitled|temp|tmp|xyz|abc)\b/i;
const GENERIC = new Set([
  "send mail",
  "send email",
  "send an email",
  "send whatsapp",
  "send sms",
  "send message",
  "new rule",
  "new automation",
  "rule",
  "automation",
  "workflow",
]);
const MODULE_WORDS: Array<{ module: string; words: RegExp }> = [
  { module: "leads", words: /\bleads?\b|\bprospects?\b/i },
  { module: "investors", words: /\bclients?\b|\binvestors?\b/i },
];

/**
 * Why a rule's name needs attention, or null. Heuristic by design: it only
 * asks a person to look.
 */
export function nameProblem(rule: { name: string; module: string }): string | null {
  const n = rule.name.trim();
  if (n.length < RULE_NAME_MIN) return "too short to say what it does";
  if (GENERIC.has(n.toLowerCase().replace(/\s+/g, " "))) return "doesn't say when it runs or for whom";
  if (TEST_WORDS.test(n)) return "looks like a test";
  // Name says "client" but the rule watches leads (or the other way round).
  // Only for those two modules: a SIP or task rule mentioning the client is normal.
  if (!MODULE_WORDS.some((x) => x.module === rule.module)) return null;
  for (const m of MODULE_WORDS) {
    if (m.module !== rule.module && m.words.test(n) && !MODULE_WORDS.find((x) => x.module === rule.module)?.words.test(n)) {
      return `the name mentions ${m.module === "leads" ? "leads" : "clients"}, but it runs on ${moduleNoun(rule.module)}s`;
    }
  }
  return null;
}
