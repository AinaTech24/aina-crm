-- Client master: date of demise, for every client type. Saving one (client
-- form / API) marks the client Inactive, stops their active SIPs in the CRM and
-- cancels their pending orders — see src/lib/investors/demise.ts.
-- investors already has tenant RLS; a column needs no policy.
ALTER TABLE investors ADD COLUMN IF NOT EXISTS date_of_demise date;
