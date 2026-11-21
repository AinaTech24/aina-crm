/**
 * A strong password an admin can read out or paste: 14 characters with
 * upper, lower, digits and a symbol, and no look-alikes (0/O, 1/l/I).
 * Plain module — runs in the browser (the Set password dialog) and on the
 * server. Uses the Web Crypto RNG, never Math.random.
 */

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "@#$%&*?!";
const ALL = UPPER + LOWER + DIGIT + SYMBOL;

function pick(set: string, n: number): string[] {
  const out: string[] = [];
  const buf = new Uint32Array(n);
  globalThis.crypto.getRandomValues(buf);
  for (const v of buf) out.push(set[v % set.length]);
  return out;
}

export function generatePassword(length = 14): string {
  const chars = [...pick(UPPER, 1), ...pick(LOWER, 1), ...pick(DIGIT, 1), ...pick(SYMBOL, 1), ...pick(ALL, Math.max(0, length - 4))];
  // Fisher–Yates with the same RNG, so the guaranteed classes are not always first.
  const r = new Uint32Array(chars.length);
  globalThis.crypto.getRandomValues(r);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = r[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** The rule a password set by an admin must meet (the sign-in form's minimum is 8). */
export function passwordProblem(p: string): string | null {
  if (p.length < 10) return "Use at least 10 characters.";
  if (p.length > 128) return "Use at most 128 characters.";
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)) return "Mix upper-case, lower-case letters and digits.";
  return null;
}
