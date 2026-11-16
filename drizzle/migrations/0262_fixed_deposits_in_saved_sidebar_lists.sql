-- Fixed Deposits for every firm (2026-11-16, the owner's instruction "allow
-- all firm now").
--
-- The FD module (0226) joined the sidebar access catalog after many firms,
-- packages and team members already had a SAVED allow-list. A saved list grants
-- only what is in it (src/config/nav-access.ts), so for them Fixed Deposits
-- was hidden from the menu and its pages refused. Firms on the package default
-- (no saved list) already see it and are not touched.
--
-- This adds '/dashboard/fixed-deposits' to:
--   1. every firm's own sidebar grant  (subscriptions.allowed_nav, when set)
--   2. every package's feature list    (packages.enabled_features, when set)
--   3. every team member's own grant that already includes Business Entries
--      (users.enabled_modules) — FD belongs to the same Business group, and
--      without this an RM on a saved list would still not see it. Owners
--      always get the firm's full set and need nothing.
-- Additive only: nothing is removed, and a list that already has the item is
-- left as it is. Role rules (owner, branch head, RM, back office, ops,
-- compliance) still apply on top.

-- subscriptions and users are tenant tables with FORCED row-level security;
-- the update covers every firm, so it runs with the platform flag the
-- tenant_isolation policy honours. Local to this file's transaction.
SELECT set_config('app.is_platform_admin', 'true', true);

UPDATE subscriptions
   SET allowed_nav = allowed_nav || '["/dashboard/fixed-deposits"]'::jsonb
 WHERE allowed_nav IS NOT NULL
   AND jsonb_typeof(allowed_nav) = 'array'
   AND NOT allowed_nav ? '/dashboard/fixed-deposits';

UPDATE packages
   SET enabled_features = enabled_features || '["/dashboard/fixed-deposits"]'::jsonb
 WHERE jsonb_typeof(enabled_features) = 'array'
   AND jsonb_array_length(enabled_features) > 0
   AND NOT enabled_features ? '/dashboard/fixed-deposits';

UPDATE users
   SET enabled_modules = enabled_modules || '["/dashboard/fixed-deposits"]'::jsonb
 WHERE enabled_modules IS NOT NULL
   AND jsonb_typeof(enabled_modules) = 'array'
   AND enabled_modules ? '/dashboard/business-entries'
   AND NOT enabled_modules ? '/dashboard/fixed-deposits';
