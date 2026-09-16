jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "en" }] }));

import { resources } from "../index";

/** Flatten {a:{b:"x"}} → ["a.b"] so every locale can be diffed against English. */
function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

describe("i18n resources", () => {
  const en = keys(resources.en.translation as any).sort();

  it.each(["hi", "gu"] as const)("%s has every English key and no extras", (lng) => {
    const other = keys((resources as any)[lng].translation).sort();
    expect(other).toEqual(en);
  });

  it("keeps interpolation placeholders in every language", () => {
    for (const lng of ["en", "hi", "gu"] as const) {
      expect((resources as any)[lng].translation.home.greeting).toContain("{{name}}");
    }
  });
});
