-- Auth guards: server-minted session tokens, so a login can be re-verified.
--
-- Before this migration, "being logged in" was only a `currentUser` JSON blob
-- in localStorage. Anyone at a terminal (or anyone who opened the site URL and
-- read a user id from the login dropdown) could write a fake blob with an
-- admin's id and reload — no PIN ever checked (audit SEC-2).
--
-- After it, login_with_pin() verifies the PIN server-side (same contract as
-- check_pin from secure_pin_check.sql) AND mints a random session token whose
-- hash is stored on the user row. The app stores the token locally and
-- re-verifies it with verify_session() on boot/refresh; a wrong or missing
-- token logs that terminal out.
--
-- Terminals: each login adds a token; a user keeps the newest 8, so up to 8
-- terminals stay signed in at once per account. Logging in on a 9th rotates
-- the oldest out (that terminal is signed out on its next refresh). Logout in
-- the app also calls revoke_session() to delete its token server-side
-- (best-effort: a network blip or an unmigrated store never blocks logging
-- out locally — then the token simply ages out through rotation).
--
-- Ordering / compatibility (same ritual as applied/secure_pin_check.sql):
--   * Run AFTER deploying the matching app build. The new app probes for
--     login_with_pin and falls back to check_pin (and from there to the legacy
--     client-side compare) when it does not exist yet, so nothing breaks on
--     stores that have not run this.
--   * Requires the check_pin pack to have run first: it is
--     migrations/applied/secure_pin_check.sql on older live stores, and the
--     same statements live in migrations/full_schema.sql section 13 for
--     stores built from the full schema. Its explicit SELECT column list on
--     users is what keeps session_tokens unreadable.
--   * Old app builds keep working: they never call these functions, and the
--     UPDATE column list below covers every column the app writes.
--   * ONE-TIME LOGOUT, plan for it: every session that logged in BEFORE this
--     migration runs (including logins made through the check_pin fallback in
--     the deploy-to-migration window) holds no token, so its next refresh gets
--     verify_session = false and that terminal lands back on the login screen
--     mid-whatever-it-was-doing. Every signed-in terminal in the store re-
--     enters its PIN once. Run this off-hours, not mid-shift.
--
-- SCOPE — honest limits (RLS is still disabled; see the roadmap item):
--   * This stops the localStorage-forgery login bypass via the app and the
--     PostgREST API (session_tokens can be neither read nor written by the
--     anon role after this runs).
--   * It does NOT stop an attacker who extracts the anon key from writing to
--     OTHER columns the app legitimately writes (e.g. overwriting a PIN and
--     then logging in normally). That needs Supabase Auth + RLS (SEC-1).
--   * Tokens are random 64-hex-char values; only their md5 is stored, so a
--     database read-out does not yield usable tokens.

-- 1) Hashed session tokens live on the user row. Never exposed via the API:
--    secure_pin_check.sql's explicit column grant does not include it, and the
--    grants below re-assert both directions.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_tokens TEXT[];

-- 2) Login: verify the PIN (identical matching rules to check_pin — empty or
--    unset PINs never match, NULL user id matches nothing) and mint a token.
CREATE OR REPLACE FUNCTION login_with_pin(p_pin TEXT, p_user_id TEXT DEFAULT NULL)
RETURNS TABLE (id TEXT, name TEXT, email TEXT, role_id TEXT, session_token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user users%ROWTYPE;
    v_token TEXT;
BEGIN
    SELECT * INTO v_user
    FROM users u
    WHERE p_user_id IS NOT NULL
      AND u.id = p_user_id
      AND btrim(coalesce(u.pin, '')) <> ''
      AND btrim(u.pin) = btrim(p_pin)
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN; -- empty result = wrong PIN (never an exception: the app treats errors as outages)
    END IF;

    -- 64 hex chars of randomness (gen_random_uuid is core since PG13).
    v_token := md5(gen_random_uuid()::text || clock_timestamp()::text)
            || md5(gen_random_uuid()::text || random()::text);

    -- Append the new token's hash, keep only the newest 8 — in ONE statement,
    -- reading the array inside the UPDATE itself. Append-then-write from the
    -- v_user copy was a read-modify-write race: two terminals logging in to
    -- the same shared account at once could overwrite each other's append,
    -- silently logging the first terminal out on its next refresh. The UPDATE
    -- row lock serializes concurrent appends (READ COMMITTED re-reads the
    -- row's latest version after waiting on the lock).
    UPDATE users u
    SET session_tokens = (
        SELECT array_agg(t ORDER BY ord)
        FROM unnest(coalesce(u.session_tokens, '{}') || md5(v_token)) WITH ORDINALITY AS x(t, ord)
        WHERE ord > coalesce(array_length(u.session_tokens, 1), 0) + 1 - 8
    )
    WHERE u.id = v_user.id;

    RETURN QUERY SELECT v_user.id, v_user.name, v_user.email, v_user.role_id, v_token;
END;
$$;

REVOKE ALL ON FUNCTION login_with_pin(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_with_pin(TEXT, TEXT) TO anon, authenticated;

-- 3) Cheap re-verification for boot/refresh: does this (user, token) pair
--    belong to a real login? Never raises — a missing user is just FALSE.
CREATE OR REPLACE FUNCTION verify_session(p_user_id TEXT, p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM users u
        WHERE u.id = p_user_id
          AND btrim(coalesce(p_token, '')) <> ''
          AND md5(btrim(p_token)) = ANY (coalesce(u.session_tokens, '{}'))
    );
$$;

REVOKE ALL ON FUNCTION verify_session(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_session(TEXT, TEXT) TO anon, authenticated;

-- 3b) Logout: delete this terminal's token server-side, so a copied token
--     (e.g. read out of a terminal's localStorage before the machine changed
--     hands) cannot revive the session after a visible logout. Holding the
--     token is the proof of ownership — only a real login ever had it. Never
--     raises; revoking an unknown token is a quiet no-op.
CREATE OR REPLACE FUNCTION revoke_session(p_user_id TEXT, p_token TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE users u
    SET session_tokens = array_remove(u.session_tokens, md5(btrim(p_token)))
    WHERE u.id = p_user_id
      AND btrim(coalesce(p_token, '')) <> '';
$$;

REVOKE ALL ON FUNCTION revoke_session(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_session(TEXT, TEXT) TO anon, authenticated;

-- 4) Column privileges, both directions (safe to re-run):
--    * SELECT: same explicit list as secure_pin_check.sql — neither pin nor
--      session_tokens is readable through the API.
--    * UPDATE: restricted to the columns the app actually writes (User
--      Management's updateUser), so the API cannot plant a forged token hash
--      on someone's row. pin stays writable — changing passwords from User
--      Management is a real flow; protecting THAT needs RLS (SEC-1).
REVOKE SELECT ON users FROM anon;
REVOKE SELECT ON users FROM authenticated;
GRANT SELECT (id, name, email, role_id, created_at, base_salary, daily_target, weekly_target, monthly_target)
    ON users TO anon, authenticated;
REVOKE UPDATE ON users FROM anon;
REVOKE UPDATE ON users FROM authenticated;
GRANT UPDATE (name, email, role_id, pin, base_salary, daily_target, weekly_target, monthly_target)
    ON users TO anon, authenticated;
--    * INSERT: same idea — without a column list, an API caller could INSERT
--      a fresh users row with a pre-chosen session_tokens hash and "log in"
--      as it. The list matches exactly what addUser (StoreContext) sends;
--      created_at keeps its default.
REVOKE INSERT ON users FROM anon;
REVOKE INSERT ON users FROM authenticated;
GRANT INSERT (id, name, email, role_id, pin, base_salary, daily_target, weekly_target, monthly_target)
    ON users TO anon, authenticated;

-- 5) Make PostgREST pick the new functions and privileges up immediately.
NOTIFY pgrst, 'reload schema';
