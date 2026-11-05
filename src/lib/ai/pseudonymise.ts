/**
 * Keep direct identifiers out of what the AI provider sees (DPDP: share only
 * what the purpose needs). Before a prompt leaves the CRM, each PAN, Aadhaar
 * number, Indian mobile number and email address in it becomes a placeholder
 * — [PAN_1], [AADHAAR_1], [PHONE_1], [EMAIL_1] — and the same value always
 * gets the same placeholder, so the model can still reason about "the client
 * whose mobile is [PHONE_1]". The placeholders in the answer are put back,
 * so a draft or a filter built by the model carries the real values.
 *
 * Applied in lib/ai/provider.ts to every call. Names are NOT replaced: a draft
 * addressed to "[NAME_1]" would be useless, and a name alone is the least
 * sensitive of these.
 */

const RULES: Array<{ kind: string; re: RegExp }> = [
  // PAN: five letters, four digits, a letter.
  { kind: "PAN", re: /\b[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]\b/g },
  // Aadhaar: 12 digits, optionally grouped 4-4-4, not starting with 0 or 1.
  { kind: "AADHAAR", re: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  // Email.
  { kind: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Indian mobile: optional +91 / 91 / 0, then 10 digits starting 6-9.
  { kind: "PHONE", re: /(?<![\d+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g },
];

export type Pseudonymiser = {
  /** Replace identifiers in a piece of text. */
  hide: (text: string) => string;
  /** Put the real values back. */
  reveal: (text: string) => string;
  /** How many distinct values were hidden. */
  count: () => number;
};

export function createPseudonymiser(): Pseudonymiser {
  const toToken = new Map<string, string>();
  const toValue = new Map<string, string>();
  const n: Record<string, number> = {};

  const hide = (text: string) => {
    let out = text;
    for (const { kind, re } of RULES) {
      out = out.replace(re, (m) => {
        const key = `${kind}:${m}`;
        let token = toToken.get(key);
        if (!token) {
          n[kind] = (n[kind] ?? 0) + 1;
          token = `[${kind}_${n[kind]}]`;
          toToken.set(key, token);
          toValue.set(token, m);
        }
        return token;
      });
    }
    return out;
  };

  const reveal = (text: string) =>
    toValue.size ? text.replace(/\[(PAN|AADHAAR|EMAIL|PHONE)_\d+\]/g, (t) => toValue.get(t) ?? t) : text;

  return { hide, reveal, count: () => toValue.size };
}

type Block = { type?: string; text?: string; [k: string]: unknown };
type Message = { role: string; content: string | Block[] };

/** Hide identifiers in the system prompt and every text part of every message. */
export function hideInRequest<P extends { system?: string; messages: Message[] }>(p: P, ps: Pseudonymiser): P {
  return {
    ...p,
    system: p.system != null ? ps.hide(p.system) : p.system,
    messages: p.messages.map((m) => ({
      ...m,
      content:
        typeof m.content === "string"
          ? ps.hide(m.content)
          : m.content.map((b) => (b.type === "text" && typeof b.text === "string" ? { ...b, text: ps.hide(b.text) } : b)),
    })),
  };
}

/** Put real values back into the text parts of a provider response. */
export function revealInResponse<R extends { content?: Block[] }>(r: R, ps: Pseudonymiser): R {
  if (!ps.count() || !Array.isArray(r.content)) return r;
  return { ...r, content: r.content.map((b) => (b.type === "text" && typeof b.text === "string" ? { ...b, text: ps.reveal(b.text) } : b)) };
}
