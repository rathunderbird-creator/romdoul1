-- App configuration: merge changes inside the database instead of letting
-- each terminal overwrite the whole app_config blob. Run once in each
-- instance's Supabase SQL editor (Romdoul1, Romdoul2, Romdoul3). Safe to
-- re-run. No prerequisites beyond the app_config table itself.
--
-- Every settings write used to upsert the ENTIRE config JSON from that
-- terminal's in-memory copy, which is only re-read on boot, every 20 minutes
-- or on manual refresh. Any edit on terminal A (pin a product, drag a row,
-- mark a scammer) therefore silently reverted everything saved on terminal B
-- since A last loaded: blocklist entries, roles, shipping settings, all of it
-- (audit APP-1).
--
-- update_app_config fixes that honestly: it locks the config row, applies
-- ONLY the operations the client sends — per top-level key — onto the stored
-- JSON, and returns the merged result so the client can refresh its cache.
-- Writers to DIFFERENT keys both win regardless of how stale their screens
-- are. Writes to the SAME key are last-write-wins for 'set', which is the
-- accepted behaviour for scalar settings; list-shaped keys (blockedCustomers,
-- categories, roles, ...) use append/removeItems/updateItems so two terminals
-- adding DIFFERENT entries concurrently both keep their entry.
--
-- p_ops is a JSON object: { "<top-level key>": <operation>, ... } where each
-- operation is one of
--   {"op":"set","value":<json>}             replace the key (last write wins)
--   {"op":"remove"}                         delete the key from the config
--   {"op":"merge","value":{...}}            shallow-merge into an object key
--                                           (e.g. one shipping company's rate)
--   {"op":"unsetKeys","keys":["a",...]}     delete fields of an object key
--   {"op":"append","items":[...]}           add items an array key doesn't
--                                           already hold (identity: see below)
--   {"op":"prepend","items":[...]}          same, but new items go first
--   {"op":"removeItems","values":[...]}     remove matching items
--   {"op":"updateItems","items":[...]}      replace matching items in place
--
-- Array item identity: with "idKey":"phone" (or "id", "code", ...) two object
-- items are the same when that field matches; without idKey, whole-value
-- equality. "norm":"phone" compares digits only — the blocklist stores phones
-- in mixed formats ('012 345 678', '+855 12...'), same rule as the app's
-- normalizePhone. removeItems' "values" are compared against that same key
-- (so the app can pass plain phone strings to unblock customers).
--
-- Until this file is run, the app probes app_config_functions_ready(),
-- notices the function is missing and quietly falls back to the old
-- whole-blob write — config edits keep working, they just keep the old risk.

-- The probe the app uses to ask whether this file has been run.
CREATE OR REPLACE FUNCTION app_config_functions_ready()
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$ SELECT true $$;

CREATE SCHEMA IF NOT EXISTS cfg_internal;
GRANT USAGE ON SCHEMA cfg_internal TO anon, authenticated;

-- The comparable identity of one array item under an operation's idKey/norm
-- rules (see the header). NULL input stays NULL so a malformed item simply
-- never matches anything.
CREATE OR REPLACE FUNCTION cfg_internal.cfg_item_key(p_item JSONB, p_id_key TEXT, p_norm TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_item IS NULL THEN NULL
        ELSE (
            WITH raw AS (
                SELECT CASE
                    WHEN p_id_key IS NOT NULL AND jsonb_typeof(p_item) = 'object'
                        THEN p_item ->> p_id_key
                    ELSE p_item #>> '{}'
                END AS v
            )
            SELECT CASE
                WHEN v IS NULL THEN NULL
                WHEN p_norm = 'phone' THEN regexp_replace(v, '\D', '', 'g')
                ELSE v
            END FROM raw
        )
    END;
$$;

-- One operation applied to one key's current value. 'remove' never reaches
-- this (the caller drops the key instead).
CREATE OR REPLACE FUNCTION cfg_internal.cfg_apply_op(p_cur JSONB, p_op JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_kind TEXT := p_op ->> 'op';
    v_id_key TEXT := p_op ->> 'idKey';
    v_norm TEXT := p_op ->> 'norm';
    v_arr JSONB;
    v_out JSONB;
    v_item JSONB;
    v_new JSONB;
    v_key TEXT;
    v_k TEXT;
    v_found BOOLEAN;
BEGIN
    IF v_kind = 'set' THEN
        RETURN p_op -> 'value';
    ELSIF v_kind = 'merge' THEN
        RETURN (CASE WHEN p_cur IS NOT NULL AND jsonb_typeof(p_cur) = 'object' THEN p_cur ELSE '{}'::jsonb END)
            || COALESCE(p_op -> 'value', '{}'::jsonb);
    ELSIF v_kind = 'unsetKeys' THEN
        v_out := CASE WHEN p_cur IS NOT NULL AND jsonb_typeof(p_cur) = 'object' THEN p_cur ELSE '{}'::jsonb END;
        FOR v_k IN SELECT jsonb_array_elements_text(COALESCE(p_op -> 'keys', '[]'::jsonb)) LOOP
            v_out := v_out - v_k;
        END LOOP;
        RETURN v_out;
    ELSIF v_kind IN ('append', 'prepend') THEN
        v_arr := CASE WHEN p_cur IS NOT NULL AND jsonb_typeof(p_cur) = 'array' THEN p_cur ELSE '[]'::jsonb END;
        v_new := '[]'::jsonb;
        FOR v_item IN SELECT jsonb_array_elements(COALESCE(p_op -> 'items', '[]'::jsonb)) LOOP
            v_key := cfg_internal.cfg_item_key(v_item, v_id_key, v_norm);
            -- Skip an item the stored array (or this batch) already holds, so
            -- a retried save or two terminals adding the SAME entry never
            -- duplicate it.
            SELECT EXISTS (
                SELECT 1 FROM jsonb_array_elements(v_arr || v_new) e(val)
                WHERE cfg_internal.cfg_item_key(e.val, v_id_key, v_norm) IS NOT DISTINCT FROM v_key
            ) INTO v_found;
            IF NOT v_found THEN
                v_new := v_new || jsonb_build_array(v_item);
            END IF;
        END LOOP;
        RETURN CASE WHEN v_kind = 'prepend' THEN v_new || v_arr ELSE v_arr || v_new END;
    ELSIF v_kind = 'removeItems' THEN
        v_arr := CASE WHEN p_cur IS NOT NULL AND jsonb_typeof(p_cur) = 'array' THEN p_cur ELSE '[]'::jsonb END;
        RETURN COALESCE((
            SELECT jsonb_agg(e.val ORDER BY e.ord)
            FROM jsonb_array_elements(v_arr) WITH ORDINALITY e(val, ord)
            WHERE NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(p_op -> 'values', '[]'::jsonb)) r(val)
                WHERE cfg_internal.cfg_item_key(r.val, v_id_key, v_norm)
                      IS NOT DISTINCT FROM cfg_internal.cfg_item_key(e.val, v_id_key, v_norm)
            )
        ), '[]'::jsonb);
    ELSIF v_kind = 'updateItems' THEN
        v_arr := CASE WHEN p_cur IS NOT NULL AND jsonb_typeof(p_cur) = 'array' THEN p_cur ELSE '[]'::jsonb END;
        RETURN COALESCE((
            SELECT jsonb_agg(
                COALESCE((
                    SELECT r.val FROM jsonb_array_elements(COALESCE(p_op -> 'items', '[]'::jsonb)) r(val)
                    WHERE cfg_internal.cfg_item_key(r.val, v_id_key, v_norm)
                          IS NOT DISTINCT FROM cfg_internal.cfg_item_key(e.val, v_id_key, v_norm)
                    LIMIT 1
                ), e.val)
                ORDER BY e.ord)
            FROM jsonb_array_elements(v_arr) WITH ORDINALITY e(val, ord)
        ), '[]'::jsonb);
    ELSE
        RAISE EXCEPTION 'update_app_config: unknown operation "%"', COALESCE(v_kind, '(none)');
    END IF;
END;
$$;

-- The one write path for settings. Locks the config row, applies each key's
-- operation onto the STORED value (never the caller's possibly stale copy)
-- and returns the merged config.
CREATE OR REPLACE FUNCTION update_app_config(p_ops JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_data JSONB;
    v_key TEXT;
    v_op JSONB;
BEGIN
    IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'object' THEN
        RAISE EXCEPTION 'update_app_config: p_ops must be a JSON object of per-key operations';
    END IF;

    -- FOR NO KEY UPDATE: concurrent terminals queue here instead of
    -- overwriting each other; each applies its operations onto the row the
    -- previous writer committed.
    SELECT data INTO v_data FROM app_config WHERE id = 1 FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        -- Fresh store: create the row, then lock it (another terminal may
        -- have inserted it between the two statements — ON CONFLICT makes
        -- that harmless).
        INSERT INTO app_config (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
        SELECT data INTO v_data FROM app_config WHERE id = 1 FOR NO KEY UPDATE;
    END IF;
    IF v_data IS NULL OR jsonb_typeof(v_data) <> 'object' THEN
        v_data := '{}'::jsonb;
    END IF;

    FOR v_key, v_op IN SELECT key, value FROM jsonb_each(p_ops) LOOP
        IF v_op IS NULL OR jsonb_typeof(v_op) <> 'object' THEN
            RAISE EXCEPTION 'update_app_config: the operation for "%" must be an object', v_key;
        END IF;
        IF v_op ->> 'op' = 'remove' THEN
            v_data := v_data - v_key;
        ELSE
            v_data := jsonb_set(v_data, ARRAY[v_key], cfg_internal.cfg_apply_op(v_data -> v_key, v_op), true);
        END IF;
    END LOOP;

    UPDATE app_config SET data = v_data WHERE id = 1;
    RETURN v_data;
END;
$$;

GRANT EXECUTE ON FUNCTION app_config_functions_ready() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cfg_internal.cfg_item_key(JSONB, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cfg_internal.cfg_apply_op(JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_app_config(JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
