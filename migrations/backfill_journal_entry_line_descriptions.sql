-- One-time DATA fix (no schema change): generate per-line descriptions for
-- auto-posted journal entries, matching what the app now writes for new
-- postings (see src/utils/journalEntryLines.ts and its call sites). The
-- view popups show these in their Description column.
--
-- Only EMPTY line descriptions on entries whose entry_number marks them as
-- auto-posted (RCP/DEP/DLV/WSP/SPP/GRN/PUR/OPA) are filled; manual entries
-- and user-written line text are never touched. Idempotent. The counterparty
-- name is read from the entry's own unified description
-- ('{Area} - {REF} — {Name}'), so run this AFTER
-- rewrite_journal_entry_descriptions_v2.sql.
UPDATE journal_entry_lines l
SET description = sub.new_desc
FROM (
    SELECT l2.id,
        CASE
            -- Cash/bank side
            WHEN a.account_type = 'Asset' AND a.account_name ~* 'cash|bank' THEN
                CASE
                    WHEN t.type_code = 'SPP' AND l2.credit > 0 THEN 'Payment — ' || t.cp
                    WHEN t.type_code = 'DEP' AND l2.debit  > 0 THEN 'Deposit — ' || t.cp
                    WHEN t.type_code = 'DLV' AND l2.debit  > 0 THEN 'Delivery fee — ' || t.cp
                    WHEN t.type_code IN ('RCP','WSP') AND l2.debit > 0 THEN 'Receipt — ' || t.cp
                END
            -- Accounts Payable
            WHEN a.account_type = 'Liability' AND a.account_name ~* 'payable' THEN
                CASE
                    WHEN t.type_code = 'SPP' AND l2.debit > 0 THEN 'Settle payable — ' || t.cp
                    WHEN t.type_code IN ('GRN','PUR','OPA') AND l2.credit > 0 THEN 'Payable — ' || t.cp
                END
            -- Revenue
            WHEN a.account_type = 'Revenue' AND a.account_name ~* 'delivery fee' AND l2.credit > 0 THEN 'Delivery fee — ' || t.cp
            WHEN a.account_type = 'Revenue' AND l2.credit > 0 THEN 'Sales — ' || t.cp
            -- Cost of Goods Sold
            WHEN a.account_type = 'Expense' AND (a.account_name ~* 'cost of goods|cogs' OR a.account_code = '5000') AND l2.debit > 0 THEN
                CASE WHEN t.type_code = 'SPP' THEN 'Purchase — ' || t.cp ELSE 'Cost of goods sold' END
            -- Inventory
            WHEN a.account_type = 'Asset' AND (a.account_name ~* 'inventor|stock' OR a.account_code = '1300') THEN
                CASE
                    WHEN t.type_code IN ('GRN','PUR') AND l2.debit > 0 THEN 'Stock received — ' || t.cp
                    WHEN l2.credit > 0 THEN 'Inventory at cost'
                END
            -- OPA offset (e.g. Opening Balance Equity)
            WHEN t.type_code = 'OPA' AND l2.debit > 0 THEN 'Opening balance — ' || t.cp
        END AS new_desc
    FROM journal_entry_lines l2
    JOIN chart_of_accounts a ON a.id = l2.account_id
    JOIN (
        SELECT je.id,
            substring(je.entry_number from '^JE-\d+-([A-Z]+)-') AS type_code,
            COALESCE(NULLIF(trim(regexp_replace(split_part(je.description, ' — ', 2), '\s*·\s*COGS$', '')), ''), 'Customer') AS cp
        FROM journal_entries je
        WHERE je.entry_number ~ '^JE-\d+-(RCP|DEP|DLV|WSP|SPP|GRN|PUR|OPA)-'
    ) t ON t.id = l2.journal_entry_id
    WHERE COALESCE(trim(l2.description), '') = ''
) sub
WHERE l.id = sub.id
  AND sub.new_desc IS NOT NULL;
