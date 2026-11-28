/**
 * How many users a firm may create.
 *
 * Two different numbers live on a subscription: `seatsOverride` is the number of users BOUGHT (it
 * prices Billing, and an online purchase replaces it); `userLimitOverride` is an allowance AINA
 * grants one firm without changing what it pays (migration 0302). The limit is the allowance or the
 * bought / package number, whichever is higher. Prices must never read the allowance.
 *
 * Plain module.
 */
export function userLimit(
  sub: { seatsOverride?: number | null; userLimitOverride?: number | null } | null | undefined,
  pkg: { maxUsers?: number | null } | null | undefined,
): number {
  const paid = sub?.seatsOverride ?? pkg?.maxUsers ?? 1;
  return Math.max(paid, sub?.userLimitOverride ?? 0);
}
