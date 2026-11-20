/**
 * Investment Options' Zoho users (org 6899105000000020005, read 2026-11-20).
 * A Zoho lookup to a user carries only its id and a partial name ("- Investment
 * Options" for "Jugal - Investment Options"), so the import resolves the id
 * here to the user's email, which is how the CRM user is found (ownerKey reads
 * an email as an email). A user not listed resolves to nothing.
 */

export const IO_ZOHO_USERS: Record<string, { name: string; email: string }> = {
  "6899105000000569001": { name: "Keval Ashar", email: "asharkeval@gmail.com" },
  "6899105000002266001": { name: "Aryan Kakkad", email: "aryan@investmentoptions.in" },
  "6899105000002267001": { name: "Jugal", email: "jugal@investmentoptions.in" },
  "6899105000002268001": { name: "Back Office MF", email: "support@investmentoptions.in" },
  "6899105000002739001": { name: "Beena", email: "beena@investmentoptions.in" },
  "6899105000002742001": { name: "Kirti", email: "kirti@investmentoptions.in" },
  "6899105000006531001": { name: "Mehul", email: "mehul@investmentoptions.in" },
  "6899105000006533001": { name: "Back Office MF", email: "mf.support@investmentoptions.in" },
  "6899105000006534001": { name: "Sumeet Sanghani", email: "insurance.support@investmentoptions.in" },
  "6899105000007121001": { name: "Harshad Ashar", email: "harshad@investmentoptions.in" },
  "6899105000008919001": { name: "Devendrasinh Jadeja", email: "devenrasinh@investmentoptions.in" },
  "6899105000008923001": { name: "Khushi Kotak", email: "khushi@investmentoptions.in" },
  "6899105000008925001": { name: "Kinnari Sampat", email: "kinnari@investmentoptions.in" },
  "6899105000008926001": { name: "Priyanka", email: "priyanka@investmentoptions.in" },
  "6899105000008927001": { name: "Nikita Sampat", email: "nikita@investmentoptions.in" },
  "6899105000008928001": { name: "Rajeshwari Gadhvi", email: "rajeshwari@investmentoptions.in" },
  "6899105000008929001": { name: "Mahesh Khatra", email: "mahesh@investmentoptions.in" },
  "6899105000008930001": { name: "Sumeet", email: "sumeet@investmentoptions.in" },
  "6899105000013960001": { name: "Devendrasinh Jadeja", email: "devendrasinh.jadeja@investmentoptions.in" },
  "6899105000018663001": { name: "Divya", email: "divya@investmentoptions.in" },
};

/** The firm's owner in Zoho — whoever the import cannot place goes to him (the user's choice, 2026-11-20). */
export const IO_DEFAULT_OWNER_ID = "6899105000000569001";

/** A Zoho user lookup ({ id, name }) → the email the CRM user is found by, or "". */
export function ioUserEmail(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const id = String((v as { id?: unknown }).id ?? "");
  return LEFT[id] ?? IO_ZOHO_USERS[id]?.email ?? "";
}

/** Logins with no CRM user → the same person's current login, else Keval Ashar. */
const LEFT: Record<string, string> = {
  "6899105000008919001": "devendrasinh.jadeja@investmentoptions.in",
  "6899105000006534001": "sumeet@investmentoptions.in",
  "6899105000002268001": "asharkeval@gmail.com",
  "6899105000006533001": "asharkeval@gmail.com",
  "6899105000008923001": "asharkeval@gmail.com",
};
