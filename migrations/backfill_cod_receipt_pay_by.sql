-- Retail Payment rows booked to 1210 COD receivable (courier) with no Method.
-- A Get File booking for a courier ticked in Sales Setup saved pay_by NULL
-- when the order had no payment method, so Retail Payment showed nothing in
-- Method. add_order_payment_functions.sql now saves 'COD' for new ones; this
-- fills the rows already booked. Only pay_by changes: no ledger line, amount
-- or date is touched. Safe to re-run (it only matches rows still NULL/blank).
-- Run in each instance's Supabase SQL editor (Romdoul1, Romdoul2, Romdoul3).

-- Preview first:
-- SELECT t.id, t.date, t.amount, t.description, t.shipping_co
--   FROM transactions t
--  WHERE t.type = 'Income' AND t.category = 'លក់រាយ' AND NULLIF(btrim(t.pay_by), '') IS NULL
--    AND EXISTS (SELECT 1 FROM journal_entries e
--                  JOIN journal_entry_lines l ON l.journal_entry_id = e.id
--                  JOIN chart_of_accounts a ON a.id = l.account_id
--                 WHERE e.reference_id = 'TX-' || t.id AND l.debit > 0 AND a.account_code = '1210');

UPDATE transactions t
   SET pay_by = 'COD'
 WHERE t.type = 'Income' AND t.category = 'លក់រាយ' AND NULLIF(btrim(t.pay_by), '') IS NULL
   AND EXISTS (SELECT 1 FROM journal_entries e
                 JOIN journal_entry_lines l ON l.journal_entry_id = e.id
                 JOIN chart_of_accounts a ON a.id = l.account_id
                WHERE e.reference_id = 'TX-' || t.id AND l.debit > 0 AND a.account_code = '1210');
