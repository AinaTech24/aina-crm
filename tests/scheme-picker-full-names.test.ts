/**
 * Scheme names must be readable in full (2026-11-26): in the picker's list, in the box after a pick,
 * and on the New task form, where a scheme field takes the whole row.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("scheme picker shows full names", () => {
  const picker = read("src/components/mf/SchemeAutocomplete.tsx");

  it("wraps names in the list instead of cutting them", () => {
    expect(picker).toContain('<span className="min-w-0 break-words">{s.schemeName}</span>');
    expect(picker).not.toContain("truncate");
  });

  it("repeats a picked name in full when the box is too narrow for it", () => {
    expect(picker).toContain("el.scrollWidth > el.clientWidth");
    expect(picker).toContain("{clipped && !showList && picked && q === picked && (");
  });

  it("gives a scheme field the whole row on the task form", () => {
    expect(read("src/components/tasks/RequestPicker.tsx")).toContain('<div className="min-w-0 sm:col-span-2">');
  });
});
