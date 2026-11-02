-- One-time DATA fix (no schema change): move auto-posted retail receipt
-- debits off 1001 Petty Cash and onto the account the payment's Method
-- actually names. The posting code used to fall back to "the first active
-- asset account whose name contains cash or bank" in raw row order — Petty
-- Cash on existing instances — so every retail receipt debited Petty Cash
-- regardless of how it was paid. New postings resolve method-aware via
-- src/utils/cashBankAccounts.ts; this backfills the entries created before
-- that shipped.
--
-- Scope: debit lines on Petty Cash belonging to auto-posted retail entries
-- (RCP/DEP/DLV numbers with a TX- reference). Manual entries and expense
-- credits that users deliberately booked against Petty Cash are untouched.
-- Idempotent — once a line is repointed it no longer sits on Petty Cash.

-- 1) Bank-ish methods -> the first bank account (lowest code, e.g.
--    1010 Bank Account (ABA)).
UPDATE journal_entry_lines l
SET account_id = bank.id
FROM journal_entries je,
     transactions t,
     chart_of_accounts petty,
     LATERAL (
         SELECT id FROM chart_of_accounts
         WHERE is_active AND account_type = 'Asset' AND account_name ~* 'bank'
         ORDER BY account_code LIMIT 1
     ) bank
WHERE l.journal_entry_id = je.id
  AND je.reference_id = 'TX-' || t.id::text
  AND je.entry_number ~ '^JE-\d+-(RCP|DEP|DLV)-'
  AND l.debit > 0
  AND petty.account_name ~* 'petty cash'
  AND l.account_id = petty.id
  AND t.pay_by ~* '(bank|transfer|card|cheque|aba|acleda)';

-- 2) Cash methods -> Cash on Hand.
UPDATE journal_entry_lines l
SET account_id = cash.id
FROM journal_entries je,
     transactions t,
     chart_of_accounts petty,
     LATERAL (
         SELECT id FROM chart_of_accounts
         WHERE is_active AND account_type = 'Asset' AND account_name ~* 'cash on hand'
         ORDER BY account_code LIMIT 1
     ) cash
WHERE l.journal_entry_id = je.id
  AND je.reference_id = 'TX-' || t.id::text
  AND je.entry_number ~ '^JE-\d+-(RCP|DEP|DLV)-'
  AND l.debit > 0
  AND petty.account_name ~* 'petty cash'
  AND l.account_id = petty.id
  AND t.pay_by ~* 'cash';
