/** Only a previously stored, still-valid session may unlock cached records. */
export function isUnexpiredSession(token: string, now = Date.now()): boolean {
  try {
    const part = token.split(".")[1];
    const p = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof p.exp === "number" && Number.isFinite(p.exp) && p.exp * 1000 > now;
  } catch { return false; }
}
