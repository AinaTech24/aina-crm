-- Fixed deposits: the date interest is paid (a payout FD's next / first interest
-- date; a cumulative FD pays with the principal on its maturity date).
-- Nullable and additive: existing deposits keep working and simply show "—".
ALTER TABLE fixed_deposits ADD COLUMN IF NOT EXISTS interest_payout_date date;
