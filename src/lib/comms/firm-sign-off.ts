/**
 * The firm's identity as it must close a client message: the registered name and
 * the ARN. One place, so a WhatsApp template can carry it as a single variable
 * instead of two, and "ARN-ARN-123456" cannot happen when the ARN was saved with
 * its prefix.
 */

/** The ARN number alone: "ARN-249212", "arn 249212" and "249212" all give "249212". */
export function bareArn(arn: string | null | undefined): string {
  return String(arn ?? "").trim().replace(/^arn[\s-]*/i, "");
}

export function firmSignOffTokens(tenant: {
  legalName?: string | null;
  displayName?: string | null;
  arn?: string | null;
}): { firm_sign_off: string; arn_no: string; arn_name: string } {
  const name = (tenant.legalName || tenant.displayName || "").trim();
  const arn = bareArn(tenant.arn);
  return {
    firm_sign_off: arn ? `${name} (ARN-${arn})` : name,
    arn_no: arn,
    arn_name: name,
  };
}
