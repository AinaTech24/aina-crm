/**
 * The forms of one ZIP password worth trying.
 *
 * A password reaches us typed or pasted, and three things can make the text we
 * hold differ from the one the registrar used, with nothing visible on screen:
 *
 *  1. Leading / trailing whitespace. The manual upload dialog sent the password
 *     exactly as typed; Settings, the key button and "Remember this password"
 *     all `.trim()`med it. A password that really ends in a space (or a pasted
 *     non-breaking space) therefore opened a manual upload and then was saved
 *     WITHOUT it — and every automatic file was refused for ever after.
 *  2. A password saved by the old trimming code has lost that whitespace for
 *     good, so a trimmed one is also tried with a single space put back.
 *  3. ZipCrypto (the old "standard" ZIP encryption) takes the password as bytes
 *     and tools disagree on how to turn "Pässword" into them: zip.js uses one
 *     byte per character, Info-ZIP / most Linux tools use UTF-8. A non-ASCII
 *     password is also tried as its UTF-8 bytes.
 *
 * The exact text is always first, so an ordinary password costs one attempt.
 * Unzip attempts are cheap and stop at the first that opens.
 */

/** Line breaks in a password are always a paste accident; everything else is kept. */
export function cleanTypedPassword(s: string): string {
  return s.replace(/[\r\n]+/g, "");
}

/**
 * Forms of a password a registrar's web form may have turned it into before it reached
 * the archive (2026-11-18: an AES archive that no typed or saved password opened although
 * the person said the password was right). Each is only ever TRIED; an AES archive's
 * 2-byte check is exact, so a form that is not the real one cannot pass.
 *
 *  - the web form's own damage: "+" read as a space, a percent-encoded / HTML-escaped
 *    or unescaped text, whitespace inside, symbols dropped
 *  - upper / lower case
 *  - a password cut at the registrar's length limit (8, 10, 12, 15, 16 characters)
 */
export function labelledVariants(password: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const add = (label: string, v: string) => {
    if (v && !out.some(([, x]) => x === v)) out.push([label, v]);
  };
  add("as typed", password);
  const trimmed = password.trim();
  add("trimmed", trimmed);
  if (trimmed === password) {
    // saved after the old code had already stripped it
    add("+ trailing space", `${password} `);
    add("+ leading space", ` ${password}`);
  }
  const t = trimmed;
  add("UPPER case", t.toUpperCase());
  add("lower case", t.toLowerCase());
  add("symbols dropped", t.replace(/[^A-Za-z0-9]/g, ""));
  add("inner spaces dropped", t.replace(/\s+/g, ""));
  add("+ read as a space", t.replace(/\+/g, " "));
  try {
    add("percent-decoded", decodeURIComponent(t));
  } catch {
    /* not percent-encoded */
  }
  add("percent-encoded", encodeURIComponent(t));
  add("HTML-escaped", t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
  add("HTML-unescaped", t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  for (const n of [8, 10, 12, 15, 16]) if (t.length > n) add(`first ${n} characters only`, t.slice(0, n));
  return out;
}

export function passwordVariants(password: string): string[] {
  const out: string[] = labelledVariants(password).map(([, v]) => v);
  // ZipCrypto written by a UTF-8 tool: the password's UTF-8 bytes, one per char.
  for (const v of [...out]) {
    // eslint-disable-next-line no-control-regex -- deliberately detecting any non-ASCII
    if (/[^\x00-\x7f]/.test(v) && !out.includes(Buffer.from(v, "utf8").toString("latin1"))) out.push(Buffer.from(v, "utf8").toString("latin1"));
  }
  return out;
}
