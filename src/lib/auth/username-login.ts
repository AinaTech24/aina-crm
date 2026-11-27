/**
 * Team logins without an email address (2026-11-27). The person signs in with a USERNAME and a
 * password their admin sets.
 *
 * `users.email` stays the sign-in key: a username is stored there as `<username>@login.invalid`.
 * ".invalid" is reserved (RFC 2606) and can never receive mail, so no schema or sign-in query
 * changes — but that stored value must never be mailed to or shown as an email address:
 * `realEmail()` for anything that sends or prints a person's email, `loginLabel()` for screens.
 *
 * Plain module — used by the server and the browser.
 */

export const USERNAME_DOMAIN = "login.invalid";
const SUFFIX = `@${USERNAME_DOMAIN}`;

export function isUsernameLogin(address: string | null | undefined): boolean {
  return !!address && address.trim().toLowerCase().endsWith(SUFFIX);
}

/** The stored sign-in address for a username. */
export function usernameAddress(username: string): string {
  return `${username.trim().toLowerCase()}${SUFFIX}`;
}

/** What a screen shows for a sign-in: the username, or the email address as it is. */
export function loginLabel(address: string | null | undefined): string {
  if (!address) return "";
  return isUsernameLogin(address) ? address.trim().slice(0, -SUFFIX.length) : address;
}

/** The person's email address, or null when they have none (a username login). */
export function realEmail(address: string | null | undefined): string | null {
  return address && !isUsernameLogin(address) ? address : null;
}

/** What was typed on a sign-in screen → the stored address. No "@" means a username. */
export function signInKey(typed: string): string {
  const t = typed.trim().toLowerCase();
  if (!t || t.includes("@")) return t;
  return usernameAddress(t);
}

/** Why a username cannot be used, or null when it can. */
export function usernameProblem(username: string): string | null {
  const u = username.trim().toLowerCase();
  if (u.includes("@")) return "A username has no @ — that is an email address.";
  if (u.length < 3 || u.length > 40) return "Use 3 to 40 characters.";
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(u)) return "Use letters, numbers, dot, dash or underscore, starting and ending with a letter or number.";
  if (u.includes("..")) return "Two dots together are not allowed.";
  return null;
}
