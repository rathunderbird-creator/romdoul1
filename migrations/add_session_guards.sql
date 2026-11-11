-- SEC-1 phase 1: the database stops trusting the app for the writes that
-- already go through functions, plus the two most abusable tables (users,
-- app_config). Run once in each instance's Supabase SQL editor (Romdoul1,
-- Romdoul2, Romdoul3). Safe to re-run.
--
-- PREREQUISITES — run these first (they define the functions this file
-- wraps; a store that skipped one gets a runtime "function sg_internal.x
-- does not exist" from the affected feature until it is run):
--   * applied/secure_pin_check.sql (or full_schema.sql section 13)
--   * add_auth_guards.sql            (login_with_pin / verify_session)
--   * add_order_status_function.sql
--   * add_order_payment_functions.sql
--   * add_wholesale_procurement_functions.sql
--   * add_stock_adjustment_posting.sql  (after create_stock_adjustments.sql)
--   * add_config_functions.sql
-- If you ever RE-RUN one of those pack files, re-run THIS file IMMEDIATELY
-- afterwards, in the same SQL-editor session: a pack re-run recreates its
-- public functions unguarded BESIDE the guarded wrappers, and until this
-- file is re-run (its mover block swaps them back behind the guards):
--   * every session-less call to that function — every OLD app build, and
--     the new build's missing-function fallback — fails with "function ...
--     is not unique" (PostgREST PGRST203): the feature is DOWN for those
--     terminals, not merely unguarded;
--   * the recreated unguarded copy is callable by anyone with the anon key.
-- Calls that DO send p_session keep working (only the guarded signature has
-- that parameter), which is why the window mostly hurts old builds.
--
-- WHAT THIS DOES
--   Until now every write function was callable by anyone holding the anon
--   key (which ships inside the app bundle): the login/session system of
--   add_auth_guards.sql proved who you are to the APP, but the database
--   itself still executed any write for anybody. This migration adds an
--   optional p_session {"user_id": ..., "token": ...} parameter to every
--   write function in the five packs, moves the original (unguarded)
--   implementations into the non-exposed sg_internal schema (PostgREST only
--   exposes public, so no unguarded variant remains callable through the
--   API), and verifies the session + the caller's role permission before
--   running the implementation. It also locks the users and app_config
--   tables down to guarded functions only.
--
-- SESSION SEMANTICS (sg_internal.sg_check)
--   * a supplied session is ALWAYS verified: an invalid {user_id, token}
--     pair is refused ('Your session has expired — log in again.') whether
--     enforcement is on or off, and a valid session's role must hold the
--     function's permission ('You do not have permission to ...').
--   * a NULL session passes while enforcement is OFF (old app builds keep
--     working during rollout) and is refused once enforcement is ON.
--   * permissions mirror the client's hasPermission exactly: role_id
--     'admin' always passes; otherwise the role is looked up by id in
--     app_config.data.roles and must list the permission; an unknown role
--     has no permissions.
--
-- ENFORCEMENT SWITCH
--   Table security_settings (no API grants at all — only this file's
--   SECURITY DEFINER helpers read it; no RPC reads or writes it). Flip it
--   per store, in the SQL editor only, after every terminal has re-logged
--   in on the new app build:
--       UPDATE security_settings SET enforce_sessions = true  WHERE id = 1;
--   Rollback:
--       UPDATE security_settings SET enforce_sessions = false WHERE id = 1;
--
-- PERMISSION MAP (same permission the client checks for that action today;
-- where the client checks nothing, the route's required permission is used
-- and marked [route]):
--   set_order_shipping_status   manage_orders / create_orders / view_orders
--                               (Orders Management 2 admits all three and
--                               gates edits per ORDER, not per permission —
--                               those per-order rules stay client-side until
--                               phase 2 ports them); a ReStock transition is
--                               gated on restock_orders alone, exactly as the
--                               client refuses it (StoreContext updateOrderStatus)
--   edit_order_items            manage_orders
--   restock_returned_orders     restock_orders  (explicit client check)
--   create_retail_order         create_orders
--   set_order_payment           manage_orders / create_orders / view_orders
--                               [routes /payment-tracking, /orders bulk edits
--                               AND OM2's drawer, which all three reach]
--   delete_retail_orders        manage_orders
--   apply_restock_payment_side  restock_orders  (part of the restock flow)
--   create/update/delete_wholesale_order,
--   set_wholesale_order_status,
--   record_customer_payment,
--   delete_customer_payment     manage_orders   [route /wholesale/*]
--   record_supplier_payments    manage_procurement [route /procurement/*]
--   receive_purchase_order      manage_procurement
--   add_product_stock           manage_inventory (Inventory Add Stock)
--   save/post_stock_adjustment  manage_inventory [route /inventory/adjust-stock]
--   update_app_config           per top-level key, see sg_config_key_check:
--     roles            admin, or manage_users under the same caps the client
--                      enforces (no admin role edits, no own-role additions,
--                      no granting permissions the caller's role lacks,
--                      whole-list replacement admin-only; ops must identify
--                      roles by idKey 'id' — the executor would otherwise
--                      match by an attacker-chosen key and sidestep the caps).
--                      STRICT: roles (and the legacy users key) require a
--                      valid session even while enforcement is off — this key
--                      is what sg_permission reads, so leaving it open during
--                      rollout would let the anon key grant any role anything
--                      and defeat every other guard, the users functions
--                      included. Consequence: the Settings role editor on OLD
--                      app builds (no session sent) fails until the new build
--                      is deployed; all other config keys keep working.
--     users (legacy)   admin only (and session-strict, see roles)
--     blockedCustomers manage_orders   (Scammers lives under /orders)
--     pinnedProducts   create_orders / process_sales / manage_inventory
--                      [no client check today: pinning happens while
--                      building an order]
--     salesOrder       create_orders / manage_orders [no client check:
--                      written as a side effect of creating an order]
--     pinnedOrderColumns view/create/manage_orders [no client check: a
--                      per-store Orders-table layout preference]
--     productOrder     manage_inventory / view_inventory_stock (the /inventory
--                      drag-reorder; the route admits both and the drag has no
--                      further client check)
--     purchaseSettings manage_procurement [route /procurement/setup]
--     wholesaleSettings manage_orders    [route /wholesale/setup]
--     customDistricts, customCommunes, removedDistrictCodes,
--     removedCommuneCodes
--                      manage_settings / manage_orders (Sales Setup,
--                      route /orders/setup = manage_orders)
--     shippingCompanies, salesmen, pages, customerCare, paymentMethods,
--     cities           manage_settings / manage_orders / manage_inventory /
--                      create_orders (edited from Settings, Sales Setup and
--                      Inventory alike, AND added inline from the checkout
--                      form's ConfigModal while taking an order — the same
--                      reason pinnedProducts accepts create_orders)
--     categories, trackingUrlTemplates
--                      manage_settings / manage_orders / manage_inventory
--     shippingRates    manage_settings / manage_orders / manage_inventory /
--                      view_reports (the Shipping report at /reports/shipping
--                      has an inline rate editor and the route needs only
--                      view_reports)
--     anything else    manage_settings
--
-- USERS TABLE LOCKDOWN (finishes SEC-3 server-side)
--   New guarded functions save_user / delete_user / set_user_pin /
--   update_user_work_fields enforce the SEC-3 rules IN SQL (see each
--   function), then direct INSERT/UPDATE/DELETE on users is revoked from
--   anon/authenticated (the explicit SELECT column grant from
--   add_auth_guards.sql stays). These four, like update_app_config, REQUIRE
--   a valid session even while enforcement is off: they are SECURITY
--   DEFINER and outlive the table revoke, so a NULL-session pass-through
--   would hand the whole lockdown back to anyone with the anon key. Only
--   the new app build calls them, and it always sends the session.
--   Exception: update_app_config accepts a NULL session while enforcement
--   is OFF — old app builds write config routinely, and config writes were
--   exactly this open before.
--   Consequence to plan for: once this runs, USER management (add/edit/
--   delete/PIN) from OLD app builds fails until the new build is deployed.
--   Config edits, orders, payments and stock keep working from old builds.
--
-- WHY SECURITY DEFINER, WHERE
--   * sg_verify / sg_enforced / sg_permission / sg_check: must read
--     users.session_tokens (revoked from the API) and security_settings
--     (no grants at all). Read-only, no dynamic SQL, fixed search_path.
--   * update_app_config, save_user, delete_user, set_user_pin,
--     update_user_work_fields: must write app_config / users AFTER the
--     direct-table revokes. Each verifies the session and permissions
--     before touching anything, uses no dynamic SQL built from inputs, and
--     raises only plain-language messages that leak no stored data.
--   * Everything else stays SECURITY INVOKER: the pack implementations
--     write tables the anon role can still write, so they gain nothing
--     from DEFINER and keep the smaller audit surface.
--
-- ROLLOUT
--   step 1  run this file (enforcement off). Nothing changes for old or
--           new app builds except: invalid sessions are refused, user
--           management and role edits need the new build (see above).
--   step 2  deploy the matching app build (it sends p_session everywhere).
--   step 3  after every terminal has refreshed and logged in again (token
--           logins), flip enforce_sessions = true per store (see above).
--   rollback: flip enforce_sessions = false.
--   Honest caveat for the step-1/step-2 window (enforcement still off): any
--   NON-strict guarded write still accepts a NULL session, so the anon key
--   alone can still perform orders/payments/stock/config writes — exactly as
--   open as before this migration. The permission guarantees only become
--   real once enforce_sessions = true: flipping the switch is the point of
--   the rollout, not optional hardening. (The roles/users config keys and
--   the four users functions are strict from step 1, so the permission
--   DATA and the accounts themselves are protected during the window.)
--
-- WHAT PHASE 1 DOES **NOT** COVER (phase 2+)
--   * direct writes that never went through functions: sales/transactions/
--     journal_entries/journal_entry_lines rows written by flows not yet
--     function-routed (manual income/expense, journal entries, order edits
--     outside the five packs), products edits, customers, HR tables
--     (employees, attendance, leaves), purchase_orders/suppliers CRUD,
--     telegram_notifications, stock_movements written directly, ...
--   * reads: anyone with the anon key can still READ everything the column
--     grants allow. Read lockdown is its own project.
--   * the anon key itself: it still ships in the app bundle. Phase 1 makes
--     it useless for the guarded writes without a real login.

-- ---------------------------------------------------------------------------
-- 0) Internal schema + enforcement switch
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS sg_internal;
-- USAGE lets the SECURITY INVOKER wrappers (running as anon) reach the
-- moved implementations and sg_check. PostgREST never exposes this schema,
-- and the anon role has no other way to run SQL of its own choosing.
GRANT USAGE ON SCHEMA sg_internal TO anon, authenticated;

CREATE TABLE IF NOT EXISTS security_settings (
    id INT PRIMARY KEY DEFAULT 1,
    enforce_sessions BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO security_settings (id, enforce_sessions) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;
-- No API access in either direction; only the DEFINER helpers below read it.
REVOKE ALL ON security_settings FROM PUBLIC;
REVOKE ALL ON security_settings FROM anon;
REVOKE ALL ON security_settings FROM authenticated;

-- ---------------------------------------------------------------------------
-- 1) Session helpers
-- ---------------------------------------------------------------------------

-- Is enforcement on? DEFINER: security_settings has no grants on purpose.
CREATE OR REPLACE FUNCTION sg_internal.sg_enforced()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
    SELECT COALESCE((SELECT enforce_sessions FROM security_settings WHERE id = 1), false);
$$;

-- The user row a session belongs to, or NULL. Same matching rule as
-- verify_session (add_auth_guards.sql): md5 of the trimmed token must be in
-- users.session_tokens. DEFINER: session_tokens is not API-readable.
CREATE OR REPLACE FUNCTION sg_internal.sg_verify(p_session JSONB)
RETURNS users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
    SELECT u.*
    FROM users u
    WHERE p_session IS NOT NULL
      AND jsonb_typeof(p_session) = 'object'
      AND u.id = p_session->>'user_id'
      AND btrim(COALESCE(p_session->>'token', '')) <> ''
      AND md5(btrim(p_session->>'token')) = ANY (COALESCE(u.session_tokens, '{}'))
    LIMIT 1;
$$;

-- Does this role hold this permission? Mirrors the client's hasPermission
-- exactly: role_id 'admin' is always true; otherwise the role is found by
-- id in app_config.data.roles (unknown role: false), a role whose own id is
-- 'admin' is always true, else its permissions array must list it.
CREATE OR REPLACE FUNCTION sg_internal.sg_permission(p_role_id TEXT, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
    SELECT CASE
        WHEN p_role_id = 'admin' THEN true
        ELSE COALESCE((
            SELECT (r.role->>'id') = 'admin' OR (r.role->'permissions') ? p_perm
            FROM app_config c,
                 jsonb_array_elements(COALESCE(c.data->'roles', '[]'::jsonb)) AS r(role)
            WHERE c.id = 1 AND r.role->>'id' = p_role_id
            LIMIT 1
        ), false)
    END;
$$;

-- A role's permission list as jsonb (empty array when the role is unknown).
-- 'admin' callers are special-cased by the callers, never through this.
CREATE OR REPLACE FUNCTION sg_internal.sg_role_perms(p_role_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
    SELECT COALESCE((
        SELECT COALESCE(r.role->'permissions', '[]'::jsonb)
        FROM app_config c,
             jsonb_array_elements(COALESCE(c.data->'roles', '[]'::jsonb)) AS r(role)
        WHERE c.id = 1 AND r.role->>'id' = p_role_id
        LIMIT 1
    ), '[]'::jsonb);
$$;

-- Does p_target_role hold any permission p_caller_role does not? ('admin'
-- outranks everything and is outranked by nothing.)
CREATE OR REPLACE FUNCTION sg_internal.sg_role_outranks(p_target_role TEXT, p_caller_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
    SELECT CASE
        WHEN p_caller_role = 'admin' THEN false
        WHEN p_target_role = 'admin' THEN true
        ELSE EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(sg_internal.sg_role_perms(p_target_role)) t(perm)
            WHERE NOT (sg_internal.sg_role_perms(p_caller_role) ? t.perm)
        )
    END;
$$;

-- THE guard. Returns the verified user row, or a row of NULLs when no
-- session was supplied while enforcement is off (old app builds).
--   * session supplied: must verify, and (when p_perms is not NULL) the
--     role must hold at least one of p_perms — enforcement on or off.
--   * session NULL: passes while enforcement is off, refused once on.
CREATE OR REPLACE FUNCTION sg_internal.sg_check(p_session JSONB, p_perms TEXT[], p_action TEXT)
RETURNS users
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
DECLARE
    v_user users;
BEGIN
    IF p_session IS NULL OR jsonb_typeof(p_session) <> 'object' THEN
        IF sg_internal.sg_enforced() THEN
            RAISE EXCEPTION 'Your session has expired — log in again.';
        END IF;
        RETURN v_user; -- all-NULL row: "no caller identity, allowed (for now)"
    END IF;
    v_user := sg_internal.sg_verify(p_session);
    IF v_user.id IS NULL THEN
        RAISE EXCEPTION 'Your session has expired — log in again.';
    END IF;
    IF p_perms IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM unnest(p_perms) AS q(perm)
        WHERE sg_internal.sg_permission(v_user.role_id, q.perm)
    ) THEN
        RAISE EXCEPTION 'You do not have permission to %.', COALESCE(p_action, 'do this');
    END IF;
    RETURN v_user;
END;
$$;

-- Strict variant for the functions that outlive the table revokes: a valid
-- session is required even while enforcement is off (see the header).
CREATE OR REPLACE FUNCTION sg_internal.sg_check_strict(p_session JSONB, p_perms TEXT[], p_action TEXT)
RETURNS users
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
DECLARE
    v_user users;
BEGIN
    v_user := sg_internal.sg_verify(p_session);
    IF v_user.id IS NULL THEN
        RAISE EXCEPTION 'Your session has expired — log in again.';
    END IF;
    IF p_perms IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM unnest(p_perms) AS q(perm)
        WHERE sg_internal.sg_permission(v_user.role_id, q.perm)
    ) THEN
        RAISE EXCEPTION 'You do not have permission to %.', COALESCE(p_action, 'do this');
    END IF;
    RETURN v_user;
END;
$$;

REVOKE ALL ON FUNCTION sg_internal.sg_enforced() FROM PUBLIC;
REVOKE ALL ON FUNCTION sg_internal.sg_verify(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION sg_internal.sg_permission(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sg_internal.sg_role_perms(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sg_internal.sg_role_outranks(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sg_internal.sg_check(JSONB, TEXT[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION sg_internal.sg_check_strict(JSONB, TEXT[], TEXT) FROM PUBLIC;
-- The INVOKER wrappers run as anon and call sg_check; everything else is
-- only ever called from DEFINER context (as the owner).
GRANT EXECUTE ON FUNCTION sg_internal.sg_check(JSONB, TEXT[], TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Move the unguarded pack implementations out of the API's reach
-- ---------------------------------------------------------------------------
-- Each existing public function keeps its exact definition but moves to
-- sg_internal (its EXECUTE grants move with it — needed, the INVOKER
-- wrappers call it as anon). Re-runnable: a function already moved is
-- skipped; a function RE-created in public by a pack re-run replaces the
-- previously moved copy. Dynamic SQL here iterates a constant list — no
-- caller input is involved (this block runs in the SQL editor, once).
DO $$
DECLARE
    f TEXT;
    sigs CONSTANT TEXT[] := ARRAY[
        -- add_order_status_function.sql
        'set_order_shipping_status(text,text,text,jsonb)',
        'edit_order_items(text,jsonb,jsonb)',
        'restock_returned_orders(text[],jsonb)',
        -- add_order_payment_functions.sql
        'create_retail_order(jsonb,jsonb,jsonb)',
        'set_order_payment(text,text,jsonb,jsonb)',
        'delete_retail_orders(text[],jsonb)',
        'apply_restock_payment_side(text[],jsonb)',
        -- add_wholesale_procurement_functions.sql
        'create_wholesale_order(jsonb,jsonb,text,date)',
        'update_wholesale_order(uuid,jsonb,jsonb,text,date)',
        'set_wholesale_order_status(uuid,text)',
        'delete_wholesale_order(uuid)',
        'record_customer_payment(uuid,numeric,text,text,date,text,uuid,text,uuid)',
        'delete_customer_payment(uuid)',
        'record_supplier_payments(uuid,jsonb,text,text,date,text,uuid,text)',
        'receive_purchase_order(uuid,text,text,date,boolean)',
        'add_product_stock(text,integer,numeric,text,text,text,text,date,uuid)',
        -- add_stock_adjustment_posting.sql
        'save_stock_adjustment(uuid,jsonb,jsonb)',
        'post_stock_adjustment(uuid,text)',
        -- add_config_functions.sql
        'update_app_config(jsonb)'
    ];
BEGIN
    FOREACH f IN ARRAY sigs LOOP
        IF to_regprocedure('public.' || f) IS NOT NULL THEN
            EXECUTE format('DROP FUNCTION IF EXISTS sg_internal.%s', f);
            EXECUTE format('ALTER FUNCTION public.%s SET SCHEMA sg_internal', f);
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Guarded public wrappers (new signatures: + p_session JSONB DEFAULT NULL)
-- ---------------------------------------------------------------------------
-- PostgREST matches functions by named arguments, so old app builds (which
-- never send p_session) land on these same wrappers via the default. The
-- old signatures are gone from public (moved above), so no unguarded
-- variant remains callable through the API.

-- Order status pack — client gates (see the header's permission map): OM2
-- admits manage/create/view_orders and rules per ORDER (client-side until
-- phase 2); a ReStock transition is gated on restock_orders alone, like
-- StoreContext's updateOrderStatus (admins pass either way via sg_check).
CREATE OR REPLACE FUNCTION public.set_order_shipping_status(
    p_order_id TEXT, p_expected_status TEXT, p_new_status TEXT,
    p_fields JSONB DEFAULT '{}'::jsonb, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    IF p_new_status = 'ReStock' THEN
        PERFORM sg_internal.sg_check(p_session, ARRAY['restock_orders'], 'restock orders');
    ELSE
        PERFORM sg_internal.sg_check(p_session, ARRAY['manage_orders', 'create_orders', 'view_orders'], 'change an order''s shipping status');
    END IF;
    RETURN sg_internal.set_order_shipping_status(p_order_id, p_expected_status, p_new_status, p_fields);
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_order_items(
    p_order_id TEXT, p_items JSONB, p_fields JSONB DEFAULT '{}'::jsonb, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_orders'], 'edit an order''s items');
    RETURN sg_internal.edit_order_items(p_order_id, p_items, p_fields);
END;
$$;

CREATE OR REPLACE FUNCTION public.restock_returned_orders(
    p_ids TEXT[], p_fields JSONB DEFAULT '{}'::jsonb, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['restock_orders'], 'restock returned orders');
    RETURN sg_internal.restock_returned_orders(p_ids, p_fields);
END;
$$;

-- Order payment pack.
CREATE OR REPLACE FUNCTION public.create_retail_order(
    p_order JSONB, p_items JSONB, p_fields JSONB DEFAULT '{}'::jsonb, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['create_orders'], 'create orders');
    RETURN sg_internal.create_retail_order(p_order, p_items, p_fields);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_order_payment(
    p_order_id TEXT, p_expected_status TEXT, p_updates JSONB,
    p_fields JSONB DEFAULT '{}'::jsonb, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    -- OM2's drawer and bulk edit save payments and are reachable with
    -- create_orders / view_orders (per-order rules client-side, see header).
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_orders', 'create_orders', 'view_orders'], 'save an order''s payment');
    RETURN sg_internal.set_order_payment(p_order_id, p_expected_status, p_updates, p_fields);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_retail_orders(
    p_ids TEXT[], p_fields JSONB DEFAULT '{}'::jsonb, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_orders'], 'delete orders');
    RETURN sg_internal.delete_retail_orders(p_ids, p_fields);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_restock_payment_side(
    p_ids TEXT[], p_fields JSONB DEFAULT '{}'::jsonb, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['restock_orders'], 'cancel a restocked order''s payment');
    RETURN sg_internal.apply_restock_payment_side(p_ids, p_fields);
END;
$$;

-- Wholesale + procurement pack.
CREATE OR REPLACE FUNCTION public.create_wholesale_order(
    p_order JSONB, p_items JSONB, p_created_by TEXT DEFAULT NULL,
    p_today DATE DEFAULT CURRENT_DATE, p_session JSONB DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_orders'], 'create wholesale orders');
    RETURN sg_internal.create_wholesale_order(p_order, p_items, p_created_by, p_today);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_wholesale_order(
    p_id UUID, p_updates JSONB, p_items JSONB, p_edited_by TEXT DEFAULT NULL,
    p_today DATE DEFAULT CURRENT_DATE, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_orders'], 'edit wholesale orders');
    RETURN sg_internal.update_wholesale_order(p_id, p_updates, p_items, p_edited_by, p_today);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_wholesale_order_status(
    p_id UUID, p_status TEXT, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_orders'], 'change a wholesale order''s status');
    RETURN sg_internal.set_wholesale_order_status(p_id, p_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_wholesale_order(
    p_id UUID, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_orders'], 'delete wholesale orders');
    RETURN sg_internal.delete_wholesale_order(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_customer_payment(
    p_order_id UUID, p_amount NUMERIC, p_method TEXT, p_notes TEXT, p_pay_date DATE,
    p_received_by TEXT DEFAULT NULL, p_account_id UUID DEFAULT NULL,
    p_account_name TEXT DEFAULT NULL, p_payment_id UUID DEFAULT NULL,
    p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_orders'], 'record customer payments');
    RETURN sg_internal.record_customer_payment(p_order_id, p_amount, p_method, p_notes, p_pay_date,
                                               p_received_by, p_account_id, p_account_name, p_payment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_customer_payment(
    p_payment_id UUID, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_orders'], 'delete customer payments');
    RETURN sg_internal.delete_customer_payment(p_payment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_supplier_payments(
    p_supplier_id UUID, p_allocations JSONB, p_method TEXT, p_notes TEXT, p_pay_date DATE,
    p_paid_by TEXT DEFAULT NULL, p_account_id UUID DEFAULT NULL,
    p_account_name TEXT DEFAULT NULL, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_procurement'], 'record supplier payments');
    RETURN sg_internal.record_supplier_payments(p_supplier_id, p_allocations, p_method, p_notes,
                                                p_pay_date, p_paid_by, p_account_id, p_account_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
    p_po_id UUID, p_added_by TEXT DEFAULT NULL, p_created_by TEXT DEFAULT NULL,
    p_today DATE DEFAULT CURRENT_DATE, p_reopen_cancelled BOOLEAN DEFAULT false,
    p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_procurement'], 'receive purchase orders');
    RETURN sg_internal.receive_purchase_order(p_po_id, p_added_by, p_created_by, p_today, p_reopen_cancelled);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_product_stock(
    p_product_id TEXT, p_quantity INTEGER, p_cost NUMERIC DEFAULT 0, p_note TEXT DEFAULT '',
    p_supplier TEXT DEFAULT '', p_added_by TEXT DEFAULT NULL, p_created_by TEXT DEFAULT NULL,
    p_today DATE DEFAULT CURRENT_DATE, p_restock_id UUID DEFAULT NULL,
    p_session JSONB DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_inventory'], 'add stock');
    RETURN sg_internal.add_product_stock(p_product_id, p_quantity, p_cost, p_note, p_supplier,
                                         p_added_by, p_created_by, p_today, p_restock_id);
END;
$$;

-- Stock adjustment pack.
CREATE OR REPLACE FUNCTION public.save_stock_adjustment(
    p_id UUID, p_header JSONB, p_lines JSONB, p_session JSONB DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_inventory'], 'edit stock adjustments');
    PERFORM sg_internal.save_stock_adjustment(p_id, p_header, p_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.post_stock_adjustment(
    p_id UUID, p_created_by TEXT DEFAULT NULL, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, sg_internal, pg_temp
AS $$
BEGIN
    PERFORM sg_internal.sg_check(p_session, ARRAY['manage_inventory'], 'post stock adjustments');
    RETURN sg_internal.post_stock_adjustment(p_id, p_created_by);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_order_shipping_status(TEXT, TEXT, TEXT, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_order_items(TEXT, JSONB, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restock_returned_orders(TEXT[], JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_retail_order(JSONB, JSONB, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_payment(TEXT, TEXT, JSONB, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_retail_orders(TEXT[], JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_restock_payment_side(TEXT[], JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_wholesale_order(JSONB, JSONB, TEXT, DATE, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_wholesale_order(UUID, JSONB, JSONB, TEXT, DATE, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_wholesale_order_status(UUID, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_wholesale_order(UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(UUID, NUMERIC, TEXT, TEXT, DATE, TEXT, UUID, TEXT, UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_customer_payment(UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_payments(UUID, JSONB, TEXT, TEXT, DATE, TEXT, UUID, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(UUID, TEXT, TEXT, DATE, BOOLEAN, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_product_stock(TEXT, INTEGER, NUMERIC, TEXT, TEXT, TEXT, TEXT, DATE, UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_stock_adjustment(UUID, JSONB, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_adjustment(UUID, TEXT, JSONB) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) app_config lockdown: per-key permission map + guarded update_app_config
-- ---------------------------------------------------------------------------

-- The role-list rules (PR #215's updateRole, in SQL). Admins may do
-- anything; a manage_users holder may add/update/remove roles under the
-- same caps the client enforces; everything else is refused.
CREATE OR REPLACE FUNCTION sg_internal.sg_roles_op_check(p_user users, p_op JSONB)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
DECLARE
    v_kind TEXT := p_op ->> 'op';
    v_own JSONB;
    v_item JSONB;
    v_stored JSONB;
    v_val JSONB;
    v_perm TEXT;
BEGIN
    IF p_user.role_id = 'admin' THEN
        RETURN;
    END IF;
    IF NOT sg_internal.sg_permission(p_user.role_id, 'manage_users') THEN
        RAISE EXCEPTION 'You do not have permission to manage roles.';
    END IF;
    -- The executor (cfg_internal) matches removeItems/updateItems by the
    -- caller-supplied idKey (plus norm); the checks below inspect 'id'. A
    -- non-'id' idKey (or any norm) would let the matcher and the guard look
    -- at different fields — e.g. removeItems by name deleting the stored
    -- Administrator role while the guard sees no admin id. The client's
    -- role editor always sends idKey 'id' and no norm, so refuse the rest.
    IF (p_op ? 'idKey') AND (p_op ->> 'idKey') IS DISTINCT FROM 'id' THEN
        RAISE EXCEPTION 'Role operations must identify roles by their id.';
    END IF;
    IF p_op ? 'norm' THEN
        RAISE EXCEPTION 'Role operations must identify roles by their id.';
    END IF;
    v_own := sg_internal.sg_role_perms(p_user.role_id);

    IF v_kind IN ('append', 'prepend') THEN
        FOR v_item IN SELECT jsonb_array_elements(COALESCE(p_op -> 'items', '[]'::jsonb)) LOOP
            IF v_item ->> 'id' = 'admin' THEN
                RAISE EXCEPTION 'Only an administrator can edit the Administrator role.';
            END IF;
            FOR v_perm IN SELECT jsonb_array_elements_text(COALESCE(v_item -> 'permissions', '[]'::jsonb)) LOOP
                IF NOT (v_own ? v_perm) THEN
                    RAISE EXCEPTION 'You cannot grant permissions your own role does not have: %. Ask an administrator.', v_perm;
                END IF;
            END LOOP;
        END LOOP;
    ELSIF v_kind = 'updateItems' THEN
        FOR v_item IN SELECT jsonb_array_elements(COALESCE(p_op -> 'items', '[]'::jsonb)) LOOP
            IF v_item ->> 'id' = 'admin' THEN
                RAISE EXCEPTION 'Only an administrator can edit the Administrator role.';
            END IF;
            v_stored := sg_internal.sg_role_perms(v_item ->> 'id');
            FOR v_perm IN SELECT jsonb_array_elements_text(COALESCE(v_item -> 'permissions', '[]'::jsonb)) LOOP
                IF NOT (v_stored ? v_perm) THEN
                    -- Adding a permission the stored role does not have yet.
                    IF v_item ->> 'id' = p_user.role_id THEN
                        RAISE EXCEPTION 'You cannot add permissions to your own role. Ask an administrator.';
                    END IF;
                    IF NOT (v_own ? v_perm) THEN
                        RAISE EXCEPTION 'You cannot grant permissions your own role does not have: %. Ask an administrator.', v_perm;
                    END IF;
                END IF;
            END LOOP;
        END LOOP;
    ELSIF v_kind = 'removeItems' THEN
        FOR v_val IN SELECT jsonb_array_elements(COALESCE(p_op -> 'values', '[]'::jsonb)) LOOP
            IF v_val #>> '{}' = 'admin' OR v_val ->> 'id' = 'admin' THEN
                RAISE EXCEPTION 'The Admin role is protected and cannot be deleted.';
            END IF;
            IF v_val #>> '{}' = p_user.role_id OR v_val ->> 'id' = p_user.role_id THEN
                RAISE EXCEPTION 'You cannot delete the role you are currently signed in with.';
            END IF;
        END LOOP;
    ELSE
        -- set / remove / merge / unsetKeys replace the whole list: too
        -- coarse to audit item by item, so admin-only.
        RAISE EXCEPTION 'Only an administrator can replace the role list.';
    END IF;
END;
$$;

-- One config key's write permission. p_user may be the all-NULL row
-- (enforcement off, no session supplied): then every key passes — exactly
-- as open as the pre-lockdown direct writes were — EXCEPT roles and the
-- legacy users key, which require a session even then: app_config.data.roles
-- is what sg_permission reads, so a sessionless roles write during the
-- rollout window would let the bare anon key grant any role anything and
-- defeat every other guard (the strict users functions included).
CREATE OR REPLACE FUNCTION sg_internal.sg_config_key_check(p_user users, p_key TEXT, p_op JSONB)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
DECLARE
    v_perms TEXT[];
BEGIN
    IF p_user.id IS NULL THEN
        -- No caller identity: only reachable while enforcement is off.
        IF p_key IN ('roles', 'users') THEN
            RAISE EXCEPTION 'Your session has expired — log in again.';
        END IF;
        RETURN;
    END IF;
    IF p_user.role_id = 'admin' THEN
        RETURN;
    END IF;
    IF p_key = 'roles' THEN
        PERFORM sg_internal.sg_roles_op_check(p_user, p_op);
        RETURN;
    END IF;
    IF p_key = 'users' THEN
        -- Legacy blob copy of the users list; nothing should write it.
        RAISE EXCEPTION 'You do not have permission to change the user list.';
    END IF;
    v_perms := CASE p_key
        WHEN 'blockedCustomers'   THEN ARRAY['manage_orders']
        WHEN 'pinnedProducts'     THEN ARRAY['create_orders', 'process_sales', 'manage_inventory']
        WHEN 'salesOrder'         THEN ARRAY['create_orders', 'manage_orders']
        WHEN 'pinnedOrderColumns' THEN ARRAY['view_orders', 'create_orders', 'manage_orders']
        WHEN 'productOrder'       THEN ARRAY['manage_inventory', 'view_inventory_stock']
        WHEN 'purchaseSettings'   THEN ARRAY['manage_procurement']
        WHEN 'wholesaleSettings'  THEN ARRAY['manage_orders']
        -- Sales Setup's district/commune overrides (route /orders/setup).
        WHEN 'customDistricts'      THEN ARRAY['manage_settings', 'manage_orders']
        WHEN 'customCommunes'       THEN ARRAY['manage_settings', 'manage_orders']
        WHEN 'removedDistrictCodes' THEN ARRAY['manage_settings', 'manage_orders']
        WHEN 'removedCommuneCodes'  THEN ARRAY['manage_settings', 'manage_orders']
        -- The six lists the checkout form's ConfigModal can add to while an
        -- order is being taken: create_orders included (see the header).
        WHEN 'shippingCompanies'  THEN ARRAY['manage_settings', 'manage_orders', 'manage_inventory', 'create_orders']
        WHEN 'salesmen'           THEN ARRAY['manage_settings', 'manage_orders', 'manage_inventory', 'create_orders']
        WHEN 'pages'              THEN ARRAY['manage_settings', 'manage_orders', 'manage_inventory', 'create_orders']
        WHEN 'customerCare'       THEN ARRAY['manage_settings', 'manage_orders', 'manage_inventory', 'create_orders']
        WHEN 'paymentMethods'     THEN ARRAY['manage_settings', 'manage_orders', 'manage_inventory', 'create_orders']
        WHEN 'cities'             THEN ARRAY['manage_settings', 'manage_orders', 'manage_inventory', 'create_orders']
        WHEN 'categories'         THEN ARRAY['manage_settings', 'manage_orders', 'manage_inventory']
        -- view_reports: the Shipping report's inline rate editor (see header).
        WHEN 'shippingRates'      THEN ARRAY['manage_settings', 'manage_orders', 'manage_inventory', 'view_reports']
        WHEN 'trackingUrlTemplates' THEN ARRAY['manage_settings', 'manage_orders', 'manage_inventory']
        ELSE ARRAY['manage_settings']
    END;
    IF NOT EXISTS (
        SELECT 1 FROM unnest(v_perms) AS q(perm)
        WHERE sg_internal.sg_permission(p_user.role_id, q.perm)
    ) THEN
        RAISE EXCEPTION 'You do not have permission to change the "%" setting.', p_key;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION sg_internal.sg_roles_op_check(users, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION sg_internal.sg_config_key_check(users, TEXT, JSONB) FROM PUBLIC;

-- Guarded update_app_config. SECURITY DEFINER: direct writes on app_config
-- are revoked below, so the merge must run as the owner. The implementation
-- (sg_internal.update_app_config, from add_config_functions.sql) uses no
-- dynamic SQL and its errors expose only operation shapes, never data.
CREATE OR REPLACE FUNCTION public.update_app_config(p_ops JSONB, p_session JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
DECLARE
    v_user users;
    v_key TEXT;
    v_op JSONB;
BEGIN
    v_user := sg_internal.sg_check(p_session, NULL, NULL);
    IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'object' THEN
        RAISE EXCEPTION 'update_app_config: p_ops must be a JSON object of per-key operations';
    END IF;
    FOR v_key, v_op IN SELECT key, value FROM jsonb_each(p_ops) LOOP
        PERFORM sg_internal.sg_config_key_check(v_user, v_key, v_op);
    END LOOP;
    RETURN sg_internal.update_app_config(p_ops);
END;
$$;

REVOKE ALL ON FUNCTION public.update_app_config(JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_app_config(JSONB, JSONB) TO anon, authenticated;

-- Close the raw-table path. (Supabase grants are table-level, so the
-- table-level revoke is what matters; SELECT stays untouched.)
REVOKE INSERT, UPDATE, DELETE ON app_config FROM anon;
REVOKE INSERT, UPDATE, DELETE ON app_config FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5) users table lockdown (SEC-3, now server-side)
-- ---------------------------------------------------------------------------
-- The SEC-3 rules these enforce (previously client-side only, in
-- StoreContext's assertCanTouchUser/updateUser):
--   * nobody changes their own role (admins included);
--   * nobody deletes their own account;
--   * only admins assign the Administrator role;
--   * only admins assign a role holding permissions the caller's role
--     lacks ("you cannot build a puppet richer than yourself");
--   * only admins edit (name/email/PIN/role) or delete an account whose
--     CURRENT role outranks theirs — an admin account outranks every
--     non-admin, and the check is on the target's current role so an
--     outranking account cannot be demoted first and taken over after;
--   * payroll/target fields are a separate, milder path: manage_payroll
--     (or manage_users) may edit base_salary and the sales targets of
--     anyone, admins included (setting the owner's salary is payroll, not
--     escalation); target-ONLY edits additionally accept view_reports,
--     because the Staff Performance report (/reports/staff, view_reports)
--     has always offered its Set Targets modal with no further client gate.
-- All four are SECURITY DEFINER (direct writes on users are revoked below)
-- and REQUIRE a valid session even while enforcement is off (see header).
-- No dynamic SQL anywhere; error messages name rules, never stored values.

CREATE OR REPLACE FUNCTION public.save_user(p_session JSONB, p_user JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
DECLARE
    v_caller users;
    v_id TEXT := NULLIF(p_user ->> 'id', '');
    v_target_role TEXT;
    v_exists BOOLEAN := false;
    v_new_role TEXT := NULLIF(p_user ->> 'role_id', '');
    v_is_admin BOOLEAN;
BEGIN
    v_caller := sg_internal.sg_check_strict(p_session, ARRAY['manage_users'], 'manage users');
    v_is_admin := v_caller.role_id = 'admin';
    IF v_id IS NULL OR p_user IS NULL OR jsonb_typeof(p_user) <> 'object' THEN
        RAISE EXCEPTION 'The user to save has no id.';
    END IF;

    SELECT u.role_id INTO v_target_role FROM users u WHERE u.id = v_id;
    v_exists := FOUND;

    -- Identity, credentials and role of an account whose CURRENT role
    -- outranks the caller's are admin-only — an admin account outranks every
    -- non-admin. Checking only the NEW role here would let a manage_users
    -- holder DEMOTE an outranking account to a weak role and then re-PIN it:
    -- a two-step account takeover. (Payroll/target fields are deliberately
    -- not in this list — see update_user_work_fields.)
    IF v_exists AND NOT v_is_admin
       AND (p_user ? 'name' OR p_user ? 'email' OR p_user ? 'pin' OR p_user ? 'role_id') THEN
        IF v_target_role = 'admin' THEN
            RAISE EXCEPTION 'Only an administrator can edit an admin account.';
        END IF;
        IF v_id <> v_caller.id AND sg_internal.sg_role_outranks(v_target_role, v_caller.role_id) THEN
            RAISE EXCEPTION 'You cannot edit an account whose role has permissions your own role does not have. Ask an administrator.';
        END IF;
    END IF;

    -- Role assignment rules (also for the role a NEW account is born with).
    IF v_new_role IS NOT NULL AND (NOT v_exists OR v_new_role IS DISTINCT FROM v_target_role) THEN
        IF v_id = v_caller.id THEN
            RAISE EXCEPTION 'You cannot change your own role. Ask another administrator to do it.';
        END IF;
        IF NOT v_is_admin THEN
            IF v_new_role = 'admin' THEN
                RAISE EXCEPTION 'Only an administrator can assign the Administrator role.';
            END IF;
            IF sg_internal.sg_role_outranks(v_new_role, v_caller.role_id) THEN
                RAISE EXCEPTION 'You cannot assign a role that has permissions your own role does not have. Ask an administrator.';
            END IF;
        END IF;
    END IF;

    IF v_exists THEN
        -- Apply only the provided fields; empty name/email/role are ignored
        -- (same truthy semantics as the client's updateUser), an empty pin
        -- is a real value (clearing a PIN disables that login).
        UPDATE users SET
            name           = COALESCE(NULLIF(p_user ->> 'name', ''), name),
            email          = COALESCE(NULLIF(p_user ->> 'email', ''), email),
            role_id        = COALESCE(v_new_role, role_id),
            pin            = CASE WHEN p_user ? 'pin' THEN p_user ->> 'pin' ELSE pin END,
            base_salary    = CASE WHEN p_user ? 'base_salary'    THEN COALESCE((p_user ->> 'base_salary')::NUMERIC, 0)    ELSE base_salary END,
            daily_target   = CASE WHEN p_user ? 'daily_target'   THEN COALESCE((p_user ->> 'daily_target')::NUMERIC, 0)   ELSE daily_target END,
            weekly_target  = CASE WHEN p_user ? 'weekly_target'  THEN COALESCE((p_user ->> 'weekly_target')::NUMERIC, 0)  ELSE weekly_target END,
            monthly_target = CASE WHEN p_user ? 'monthly_target' THEN COALESCE((p_user ->> 'monthly_target')::NUMERIC, 0) ELSE monthly_target END
        WHERE id = v_id;
    ELSE
        IF NULLIF(p_user ->> 'name', '') IS NULL OR v_new_role IS NULL THEN
            RAISE EXCEPTION 'A new user needs a name and a role.';
        END IF;
        INSERT INTO users (id, name, email, role_id, pin, base_salary, daily_target, weekly_target, monthly_target)
        VALUES (v_id,
                p_user ->> 'name',
                p_user ->> 'email',
                v_new_role,
                p_user ->> 'pin',
                COALESCE((NULLIF(p_user ->> 'base_salary', ''))::NUMERIC, 0),
                COALESCE((NULLIF(p_user ->> 'daily_target', ''))::NUMERIC, 0),
                COALESCE((NULLIF(p_user ->> 'weekly_target', ''))::NUMERIC, 0),
                COALESCE((NULLIF(p_user ->> 'monthly_target', ''))::NUMERIC, 0));
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_user(p_session JSONB, p_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
DECLARE
    v_caller users;
    v_target_role TEXT;
BEGIN
    v_caller := sg_internal.sg_check_strict(p_session, ARRAY['manage_users'], 'delete users');
    IF p_id = v_caller.id THEN
        RAISE EXCEPTION 'You cannot delete your own account.';
    END IF;
    SELECT u.role_id INTO v_target_role FROM users u WHERE u.id = p_id;
    IF NOT FOUND THEN
        RETURN; -- already gone: deleting twice is a quiet no-op
    END IF;
    IF v_caller.role_id <> 'admin' THEN
        IF v_target_role = 'admin' THEN
            RAISE EXCEPTION 'Only an administrator can delete an admin account.';
        END IF;
        IF sg_internal.sg_role_outranks(v_target_role, v_caller.role_id) THEN
            RAISE EXCEPTION 'You cannot delete an account whose role has permissions your own role does not have. Ask an administrator.';
        END IF;
    END IF;
    DELETE FROM users WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_pin(p_session JSONB, p_id TEXT, p_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
DECLARE
    v_caller users;
    v_target_role TEXT;
BEGIN
    v_caller := sg_internal.sg_check_strict(p_session, ARRAY['manage_users'], 'change passwords');
    SELECT u.role_id INTO v_target_role FROM users u WHERE u.id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This user no longer exists.';
    END IF;
    IF p_id <> v_caller.id AND v_caller.role_id <> 'admin'
       AND sg_internal.sg_role_outranks(v_target_role, v_caller.role_id) THEN
        RAISE EXCEPTION 'You cannot change the password of an account whose role has permissions your own role does not have. Ask an administrator.';
    END IF;
    UPDATE users SET pin = p_pin WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_user_work_fields(p_session JSONB, p_id TEXT, p_fields JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, sg_internal, pg_temp
AS $$
DECLARE
    v_caller users;
    v_key TEXT;
BEGIN
    -- Payroll flow: base salary and the sales targets only, allowed on any
    -- account (setting the owner's salary is payroll, not an escalation).
    -- Field names are validated first because the permission depends on
    -- them: sales-target-ONLY edits also accept view_reports — the Staff
    -- Performance report (view_reports route, no further client gate) has
    -- always offered target editing. base_salary stays payroll/users-only.
    IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
        RAISE EXCEPTION 'update_user_work_fields: p_fields must be an object.';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_fields) LOOP
        IF v_key NOT IN ('base_salary', 'daily_target', 'weekly_target', 'monthly_target') THEN
            RAISE EXCEPTION 'update_user_work_fields only accepts payroll fields, not "%".', v_key;
        END IF;
    END LOOP;
    IF p_fields ? 'base_salary' THEN
        v_caller := sg_internal.sg_check_strict(p_session, ARRAY['manage_payroll', 'manage_users'], 'edit payroll fields');
    ELSE
        v_caller := sg_internal.sg_check_strict(p_session, ARRAY['manage_payroll', 'manage_users', 'view_reports'], 'edit sales targets');
    END IF;
    UPDATE users SET
        base_salary    = CASE WHEN p_fields ? 'base_salary'    THEN COALESCE((p_fields ->> 'base_salary')::NUMERIC, 0)    ELSE base_salary END,
        daily_target   = CASE WHEN p_fields ? 'daily_target'   THEN COALESCE((p_fields ->> 'daily_target')::NUMERIC, 0)   ELSE daily_target END,
        weekly_target  = CASE WHEN p_fields ? 'weekly_target'  THEN COALESCE((p_fields ->> 'weekly_target')::NUMERIC, 0)  ELSE weekly_target END,
        monthly_target = CASE WHEN p_fields ? 'monthly_target' THEN COALESCE((p_fields ->> 'monthly_target')::NUMERIC, 0) ELSE monthly_target END
    WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This user no longer exists.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_user(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_user(JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_pin(JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_user_work_fields(JSONB, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_user(JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user(JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_pin(JSONB, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_work_fields(JSONB, TEXT, JSONB) TO anon, authenticated;

-- Close the raw-table path. add_auth_guards.sql granted INSERT/UPDATE as
-- COLUMN privileges, which a table-level revoke does not remove — revoke
-- both levels explicitly. The SELECT column grant stays (the app reads the
-- user list for login and display).
REVOKE INSERT, UPDATE, DELETE ON users FROM anon;
REVOKE INSERT, UPDATE, DELETE ON users FROM authenticated;
REVOKE INSERT (id, name, email, role_id, pin, base_salary, daily_target, weekly_target, monthly_target)
    ON users FROM anon, authenticated;
REVOKE UPDATE (name, email, role_id, pin, base_salary, daily_target, weekly_target, monthly_target)
    ON users FROM anon, authenticated;

-- Make PostgREST pick the new signatures and privileges up immediately.
NOTIFY pgrst, 'reload schema';
