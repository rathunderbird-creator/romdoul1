-- Secure PIN handling: verify PINs server-side and stop exposing them via the API.
--
-- Before this migration, the app downloaded the whole users table (pin column
-- included) to every browser BEFORE login, so anyone who opened the site URL
-- could read every account's PIN from the network tab.
--
-- IMPORTANT — run this AFTER deploying the matching app version:
--   * the new app works before this migration runs (it falls back to the old
--     client-side check when the check_pin function does not exist yet), and
--     switches to the server-side check automatically once it does;
--   * OLD app versions break once this runs (their select('*') on users is
--     rejected by the column privilege below). That includes any installed
--     desktop (Electron) builds — update every machine to the new build BEFORE
--     running this, since old installs cannot be force-upgraded afterwards.
--
-- SCOPE — what this does and does not protect:
--   * It stops passive PIN harvesting (reading PINs through the API).
--   * It does NOT stop an attacker who extracts the anon key from the bundle
--     from WRITING to the users table (the app performs all writes with the
--     anon key and has no Supabase Auth, by project convention). Full write
--     protection needs Supabase Auth + RLS — tracked as a roadmap item.
--   * PINs remain plaintext in the table, and check_pin has no rate limiting;
--     hashing + attempt throttling are follow-ups.

-- 1) SECURITY DEFINER verifier: checks a PIN for ONE account and returns the
--    matched account WITHOUT the pin. Empty/unset PINs never match, and a NULL
--    user id matches nothing (no table-wide PIN spraying — both app callers
--    always pass the account id).
CREATE OR REPLACE FUNCTION check_pin(p_pin TEXT, p_user_id TEXT DEFAULT NULL)
RETURNS TABLE (id TEXT, name TEXT, email TEXT, role_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.name, u.email, u.role_id
    FROM users u
    WHERE p_user_id IS NOT NULL
      AND u.id = p_user_id
      AND btrim(coalesce(u.pin, '')) <> ''
      AND btrim(u.pin) = btrim(p_pin)
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION check_pin(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_pin(TEXT, TEXT) TO anon, authenticated;

-- 2) Column privilege: the API can no longer READ users.pin. Writes are kept so
--    User Management can still set/change PINs; every other column stays
--    readable (the app now selects explicit column lists, never *).
REVOKE SELECT ON users FROM anon;
REVOKE SELECT ON users FROM authenticated;
GRANT SELECT (id, name, email, role_id, created_at, base_salary, daily_target, weekly_target, monthly_target)
    ON users TO anon, authenticated;

-- 3) Make PostgREST pick up the new function and privileges immediately —
--    without this, a stale schema cache can briefly reject BOTH the RPC and
--    the legacy fallback, locking everyone out until the cache reloads.
NOTIFY pgrst, 'reload schema';
