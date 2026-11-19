/**
 * Can THIS process read each firm's saved RTA Mailback passwords? (read-only)
 *
 *   docker exec app-worker-1 npx tsx scripts/check-mailback-passwords.ts
 *   docker exec <web container> npx tsx scripts/check-mailback-passwords.ts     # compare the two
 *
 * Why: the passwords are stored encrypted. If the process that imports files (the worker) holds a
 * different ENCRYPTION_KEY from the one that saved them (the web app), it cannot decrypt them and
 * `readPwRow` quietly answers "no passwords" — a file is then refused although the Settings page
 * shows the password, while a password TYPED on a manual upload still works. This prints, per firm,
 * how many passwords each registrar has and whether decryption worked. Passwords are never printed.
 */
process.env.ALLOW_SYSTEM_TX ||= "1";

async function main() {
  const { withSystem } = await import("../src/db/client");
  const { sql } = await import("drizzle-orm");
  const { decrypt } = await import("../src/lib/crypto");
  const crypto = await import("node:crypto");

  const keyHex = process.env.ENCRYPTION_KEY ?? "";
  console.log(
    keyHex
      ? `ENCRYPTION_KEY: set, fingerprint ${crypto.createHash("sha256").update(keyHex).digest("hex").slice(0, 8)} (must be the SAME in web and worker)`
      : "ENCRYPTION_KEY: NOT SET in this process — nothing saved can be read here."
  );

  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT t.name AS firm, i.tenant_id, i.encrypted_config
      FROM tenant_integrations i JOIN tenants t ON t.id = i.tenant_id
      WHERE i.provider = 'rta_mailback' AND i.user_id IS NULL
      ORDER BY t.name
    `);
    return r.rows as Array<{ firm: string; tenant_id: string; encrypted_config: string }>;
  });

  let bad = 0;
  for (const r of rows) {
    try {
      const cfg = JSON.parse(decrypt(r.encrypted_config));
      const n = (k: string) => (Array.isArray(cfg[k]) ? cfg[k].filter((e: any) => e?.password).length : 0);
      const legacy = (k: string) => (cfg[k] ? 1 : 0);
      console.log(`OK     ${r.firm}: CAMS ${n("camsPasswords") + legacy("camsPassword")} · KFintech ${n("kfintechPasswords") + legacy("kfintechPassword")} saved`);
    } catch (e) {
      bad++;
      console.log(`CANNOT DECRYPT  ${r.firm}: ${(e as Error).message} — re-save its passwords from a process with the right key, or fix ENCRYPTION_KEY`);
    }
  }
  console.log(rows.length ? `\n${rows.length - bad} readable, ${bad} unreadable.` : "\nNo firm has saved RTA Mailback passwords.");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
