import { describe, expect, it } from "vitest";
import { inlineShotNumbers } from "@/components/kb/KbMarkdown";
import { KbBody, KbFolderBody } from "@/lib/kb/schema";

describe("help centre", () => {
  it("finds the screenshots an article places inline", () => {
    const text = "1. Open Clients\n\n![Select](shot:2)\n\n2. Merge\n\n![](shot:1)";
    expect([...inlineShotNumbers(text)].sort()).toEqual([1, 2]);
    expect(inlineShotNumbers("no images").size).toBe(0);
  });

  it("refuses an article slug that would shadow a static route", () => {
    for (const slug of ["category", "folder", "search"]) {
      expect(KbBody.safeParse({ slug, title: "Something" }).success).toBe(false);
    }
    expect(KbBody.safeParse({ slug: "merging-duplicate-clients", title: "Merging duplicate clients" }).success).toBe(true);
  });

  it("needs a category for a folder", () => {
    expect(KbFolderBody.safeParse({ slug: "faqs", name: "FAQs" }).success).toBe(false);
  });
});
