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

export function passwordVariants(password: string): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };
  add(password);
  const trimmed = password.trim();
  add(trimmed);
  if (trimmed === password) {
    // saved after the old code had already stripped it
    add(`${password} `);
    add(` ${password}`);
  }
  // ZipCrypto written by a UTF-8 tool: the password's UTF-8 bytes, one per char.
  for (const v of [...out]) {
    // eslint-disable-next-line no-control-regex -- deliberately detecting any non-ASCII
    if (/[^\x00-\x7f]/.test(v)) add(Buffer.from(v, "utf8").toString("latin1"));
  }
  return out;
}
