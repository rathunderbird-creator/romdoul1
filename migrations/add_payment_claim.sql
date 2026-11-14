-- A payment a Salesman entered on an order, waiting for Admin, Customer Care
-- or an Accountant to confirm it was received.
--
-- When a Salesman creates (or edits) an order with a deposit or full
-- payment, the order is saved Unpaid, nothing is booked, and what they
-- entered is kept here:
--   { "status": "Deposit" | "Paid", "amount": <USD>, "method": "...",
--     "date": "YYYY-MM-DD", "by": "<salesman>", "at": "<ISO time>",
--     "currency": "KHR", "original_amount": <riel>, "exchange_rate": <rate> }
-- The Orders page shows that status in gray. Confirming it there (picking
-- Deposit or Paid) books the money the normal way and clears this column.
--
-- Safe to run more than once, on every store; needs no other migration.
-- Until it is run, the app books a Salesman's payment immediately (as
-- before).
ALTER TABLE IF EXISTS sales ADD COLUMN IF NOT EXISTS payment_claim JSONB;

NOTIFY pgrst, 'reload schema';
