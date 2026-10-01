/**
 * Plain module so the builder's "review as client" step (a client component)
 * can show the exact words the client will sign. Re-exported from
 * ./public-link for the server routes.
 */

/**
 * What the client agrees to, recorded verbatim with their typed signature.
 *
 * The previous text had the client confirm that the investments "align with my
 * risk profile and financial goals", which puts the suitability judgement on
 * the client instead of recording that the distributor made it, and
 * "authorise the firm to execute these on my behalf", a blanket authority a
 * distributor does not hold — each transaction needs its own instruction.
 *
 * The SERVER stores this text. It used to store whatever the browser posted,
 * so the "exact agreed text" in the audit record was whatever the request
 * claimed. Worth a final read by the firm's compliance officer.
 */
export const PROPOSAL_ACCEPTANCE_TEXT =
  "I have read this proposal and the scheme details shown above. I understand these recommendations " +
  "were made by my mutual fund distributor on the basis of the risk profile and information I provided. " +
  "I accept the recommendations I have selected. I understand each investment will be made only on my " +
  "separate instruction for that transaction. Mutual fund investments are subject to market risks, and I " +
  "will read all scheme related documents carefully.";
