-- One-time DATA fix (no schema change): move every journal entry line booked
-- on 1000 Cash on Hand to the bank account (1010 Bank Account (ABA)).
-- Owner's rule: all takings are deposited to the bank, so revenue is booked
-- to the bank account by default — the app now posts new entries that way
-- (src/utils/cashBankAccounts.ts, preferBank), and this backfills the lines
-- booked to Cash on Hand before that shipped. Already applied on Romdoul1
-- (87 lines). Idempotent — once moved, nothing sits on Cash on Hand.
UPDATE journal_entry_lines l
SET account_id = bank.id
FROM chart_of_accounts cash,
     LATERAL (
         SELECT id FROM chart_of_accounts
         WHERE is_active AND account_type = 'Asset' AND account_name ~* 'bank'
         ORDER BY account_code LIMIT 1
     ) bank
WHERE cash.account_name ~* 'cash on hand'
  AND l.account_id = cash.id;
