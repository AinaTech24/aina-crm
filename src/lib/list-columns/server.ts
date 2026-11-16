import { cookies } from "next/headers";
import { parsePrefs, prefsCookieName, type ColumnPrefs } from "./prefs";

/** The signed-in person's saved column order and added fields for a module. */
export async function readColumnPrefs(moduleKey: string): Promise<ColumnPrefs> {
  const jar = await cookies();
  return parsePrefs(jar.get(prefsCookieName(moduleKey))?.value);
}
