/** "entry" → "entries", "lead" → "leads", "day" → "days" (a vowel before the y keeps it). */
export function plural(label: string, n: number): string {
  if (n === 1) return label;
  return /[^aeiou]y$/i.test(label) ? label.slice(0, -1) + "ies" : label + "s";
}
