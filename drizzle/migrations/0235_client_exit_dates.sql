-- 0235 — When a client left, and when they went quiet (the firm's request, 2026-10-15).
--
-- A client with no business today is marked Exited (or Closed) instead of
-- being deleted, so the record, its history, family, RM and documents are
-- all there when the client comes back. Two dates make that work:
--
--   investors.exited_at      set when status becomes closed / exited
--   investors.dormant_since  set when status becomes dormant
--
-- Both columns existed but nothing ever wrote them. The status is changed
-- from many places (the client form, inline edit, bulk "Update a field",
-- the nightly dormancy scan), so the rule lives here, where all of them
-- pass. A status that leaves those states clears its date.
--
-- lib/investors/client-return.ts reads exited_at: new money dated after it
-- brings the client back to Active. Additive only.

CREATE OR REPLACE FUNCTION investor_status_dates() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('closed', 'exited') THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status AND OLD.status NOT IN ('closed', 'exited') THEN
      NEW.exited_at := COALESCE(NEW.exited_at, now());
    END IF;
  ELSE
    NEW.exited_at := NULL;
  END IF;

  IF NEW.status = 'dormant' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'dormant' THEN
      NEW.dormant_since := COALESCE(NEW.dormant_since, now());
    END IF;
  ELSE
    NEW.dormant_since := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS investors_status_dates ON investors;
CREATE TRIGGER investors_status_dates
  BEFORE INSERT OR UPDATE OF status ON investors
  FOR EACH ROW
  EXECUTE FUNCTION investor_status_dates();

-- Clients already exited / dormant: their best known date is the last edit.
UPDATE investors SET exited_at = updated_at
 WHERE status IN ('closed', 'exited') AND exited_at IS NULL;
UPDATE investors SET dormant_since = updated_at
 WHERE status = 'dormant' AND dormant_since IS NULL;
