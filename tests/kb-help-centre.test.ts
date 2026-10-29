import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inlineShotNumbers } from "@/lib/kb/shots";
import { GUIDES, STARTER_FOLDERS } from "@/lib/kb/starter-guides";
import { KB_RESERVED_SLUGS, KbBody, KbFolderBody } from "@/lib/kb/schema";

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

  it("ships starter guides that are valid, unique and filed in a real folder", () => {
    const folders = new Set(STARTER_FOLDERS.map((f) => f.slug));
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const g of GUIDES) {
      expect(folders.has(g.folder)).toBe(true);
      expect(KB_RESERVED_SLUGS.includes(g.slug)).toBe(false);
      expect(KbBody.safeParse({ slug: g.slug, title: g.title, hook: g.hook, solutionMd: g.body, readMinutes: g.minutes }).success).toBe(true);
    }
  });

  it("places every screenshot, ships its file, and links only to guides that exist", () => {
    const slugs = new Set(GUIDES.map((g) => g.slug));
    for (const g of GUIDES) {
      const used = [...g.body.matchAll(/!\[[^\]]*\]\(shot:(\d+)\)/g)].map((m) => Number(m[1]));
      for (const n of used) expect(n >= 1 && n <= g.shots.length, `${g.slug} shot ${n}`).toBe(true);
      expect(new Set(used).size, `${g.slug}: every shot is placed once`).toBe(g.shots.length);
      for (const s of g.shots) expect(existsSync(`public/kb/${s.file}.jpg`), `public/kb/${s.file}.jpg`).toBe(true);
      for (const m of g.body.matchAll(/\]\(\/knowledge-base\/([a-z0-9-]+)\)/g)) expect(slugs.has(m[1]), `${g.slug} -> ${m[1]}`).toBe(true);
    }
  });
});
