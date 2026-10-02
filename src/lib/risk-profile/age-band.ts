/**
 * The risk questionnaire's age question, answered from the client's date of
 * birth. Pure — shared by the RM's wizard and anything else that asks it.
 *
 * The answer is picked from the firm's own template options: the default
 * keys (under_30 … over_65) first, else by reading the option's label
 * ("Under 30", "30 – 45", "Over 65", "60+"), so a firm that edited its bands
 * still gets the right one. No match → null, and the RM picks by hand.
 */

type Option = { value: string; label: string };

/** Whole years on `today` for a stored date of birth (YYYY-MM-DD or ISO), or null. */
export function ageFromDob(dob: string | null | undefined, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob ?? ""));
  if (!m) return null;
  // Read the calendar date as written — never through a timezone, which put
  // a birthday a day early for anyone west of UTC.
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  const month = today.getMonth() + 1;
  if (month < mo || (month === mo && today.getDate() < d)) age -= 1;
  return age >= 1 && age <= 120 ? age : null;
}

const DEFAULT_BANDS: Array<[string, (a: number) => boolean]> = [
  ["under_30", (a) => a < 30],
  ["30_to_45", (a) => a >= 30 && a <= 45],
  ["45_to_55", (a) => a > 45 && a <= 55],
  ["55_to_65", (a) => a > 55 && a <= 65],
  ["over_65", (a) => a > 65],
];

/** The option `value` an age falls in, or null when no option fits. */
export function ageBandOption(age: number, options: Option[]): string | null {
  if (!Number.isFinite(age)) return null;
  const values = new Set(options.map((o) => o.value));
  for (const [key, fits] of DEFAULT_BANDS) if (values.has(key) && fits(age)) return key;

  for (const o of options) {
    const label = o.label.toLowerCase();
    const nums = (label.match(/\d+/g) ?? []).map(Number);
    if (nums.length >= 2) {
      const [lo, hi] = nums[0] <= nums[1] ? [nums[0], nums[1]] : [nums[1], nums[0]];
      if (age >= lo && age <= hi) return o.value;
    } else if (nums.length === 1) {
      const n = nums[0];
      if (/(under|below|less|upto|up to|<)/.test(label) && age < n) return o.value;
      if (/(over|above|more|>)/.test(label) && age > n) return o.value;
      if (/\+|and above|or more/.test(label) && age >= n) return o.value;
    }
  }
  return null;
}
