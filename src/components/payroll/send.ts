/** Call a payroll API and throw its error message — shared by the payroll forms. */
export async function send<T = Record<string, unknown>>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? "Could not save");
  return j;
}

export const errText = (e: unknown, fallback = "Could not save") => (e instanceof Error ? e.message : fallback);

/** This month and the next few, as yyyy-mm (India time). */
export function monthsFrom(offsetStart: number, count: number): string[] {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetStart + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

export const monthText = (ym: string) =>
  new Date(`${ym.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export const inr = (n: number | string | null | undefined) => (n == null || n === "" ? "—" : `₹${Math.round(Number(n)).toLocaleString("en-IN")}`);
