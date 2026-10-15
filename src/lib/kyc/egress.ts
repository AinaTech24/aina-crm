/**
 * The public IP the CRM's calls to NSE leave from — what each firm asks NSE to
 * whitelist against its API user (up to 4 per user). Production's Elastic IP
 * unless the environment says otherwise.
 */
export function nseEgressIp(): string {
  return process.env.NSE_EGRESS_IP || process.env.OUTBOUND_IP || "13.204.102.20";
}
