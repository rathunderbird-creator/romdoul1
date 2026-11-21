-- Books the Collected orders saved while the database still ran the old
-- set_order_payment.
--
-- Pay Status "Collected" books the courier's COD on entry: Dr 1210 COD
-- receivable (courier) / Cr 4000 for what is still owed after a deposit,
-- plus COGS. A store that took the app update before re-running
-- add_order_payment_functions.sql saved the status and booked NOTHING
-- (no Retail Payment row, no RCP entry, cod_collected false), so 1210 never
-- went up for those orders.
--
-- This replays each such order through the real set_order_payment: the
-- order is put back to Unpaid and then saved as Collected, exactly as the
-- app does, so it books the same Draft RCP entry, the same FIFO COGS, the
-- COD flag and settle date. The entry is dated today (the day you run it),
-- like a Collected save; change v_now below to date them otherwise.
--
-- Only orders at Collected with no retail income row are touched, so it is
-- safe to re-run (a booked order is skipped). It refuses to run until the
-- functions know Collected.
--
-- RUN, per instance (Romdoul1, Romdoul2, Romdoul3), in the Supabase SQL editor:
--   1. migrations/add_order_status_function.sql
--   2. migrations/add_order_payment_functions.sql
--   3. migrations/add_session_guards.sql   (moves the new set_order_payment
--      behind the session guard; without it the app keeps calling the OLD
--      guarded copy and Collected still books nothing)
--   4. this file
--
-- Preview first:
-- SELECT s.id, s.date, s.total, s.deposit_amount, s.shipping_company
--   FROM sales s
--  WHERE s.payment_status = 'Collected'
--    AND NOT EXISTS (SELECT 1 FROM transactions t
--                     WHERE t.order_id = s.id AND t.type = 'Income'
--                       AND t.category IN ('លក់រាយ', 'លក់ឥវ៉ាន់'))
--  ORDER BY s.date;

DO $$
DECLARE
    -- When the receipts are dated (the local day of this instant, Cambodia).
    v_now TIMESTAMPTZ := now();
    v_tz_min CONSTANT INT := 420;
    v_fn TEXT;
    r RECORD;
    v_res JSONB;
    v_n INT := 0;
    v_sum NUMERIC := 0;
BEGIN
    IF NOT wp_internal.op_is_settled('Collected', false) THEN
        RAISE EXCEPTION 'set_order_payment on this database does not book Collected yet — run add_order_status_function.sql, add_order_payment_functions.sql and add_session_guards.sql first.';
    END IF;
    -- The implementation itself: behind the session guard when
    -- add_session_guards.sql is installed (the SQL editor has no app session).
    v_fn := CASE WHEN to_regprocedure('sg_internal.set_order_payment(text,text,jsonb,jsonb)') IS NOT NULL
                 THEN 'sg_internal.set_order_payment' ELSE 'public.set_order_payment' END;

    FOR r IN
        SELECT s.id, COALESCE(s.deposit_amount, 0) AS dep, COALESCE(s.total, 0) AS total
          FROM sales s
         WHERE s.payment_status = 'Collected'
           AND NOT EXISTS (SELECT 1 FROM transactions t
                            WHERE t.order_id = s.id AND t.type = 'Income'
                              AND t.category IN ('លក់រាយ', 'លក់ឥវ៉ាន់'))
         ORDER BY s.date, s.id
    LOOP
        -- Back to the status it was booked from; nothing was booked for
        -- Collected, so nothing is taken back.
        UPDATE sales SET payment_status = CASE WHEN r.dep > 0 THEN 'Deposit' ELSE 'Unpaid' END WHERE id = r.id;
        EXECUTE format('SELECT %s($1, $2, $3, $4)', v_fn) INTO v_res USING
            r.id,
            CASE WHEN r.dep > 0 THEN 'Deposit' ELSE 'Unpaid' END,
            jsonb_build_object('payment_status', 'Collected', 'amount_received', r.dep, 'settle_date', NULL),
            jsonb_build_object('added_by', 'Backfill (Collected)', 'today', to_char((v_now AT TIME ZONE 'UTC') + make_interval(mins => v_tz_min), 'YYYY-MM-DD'),
                               'tz_offset_min', v_tz_min, 'now', v_now::TEXT, 'last_edited_by', 'Backfill (Collected)');
        IF COALESCE((v_res->>'skipped')::BOOLEAN, false) OR COALESCE((v_res->>'already_applied')::BOOLEAN, false) THEN
            RAISE EXCEPTION 'Order % was not booked (%); nothing was changed.', r.id, v_res;
        END IF;
        IF jsonb_array_length(COALESCE(v_res->'notices', '[]'::jsonb)) > 0 THEN
            RAISE NOTICE 'Order %: %', r.id, v_res->'notices';
        END IF;
        v_n := v_n + 1;
        v_sum := v_sum + GREATEST(0, r.total - r.dep);
    END LOOP;
    RAISE NOTICE 'Booked % Collected order(s), $% to 1210 COD receivable (Draft entries).', v_n, round(v_sum, 2);
END $$;
