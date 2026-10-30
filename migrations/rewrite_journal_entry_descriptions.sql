-- One-time DATA fix (no schema change): rewrite existing journal entry
-- descriptions into the readable format new entries already get since the
-- "readable description" change:
--   Supplier payment:   Payment SPP-20261026-002 — Romdoul 3
--   Opening AP balance: Opening AP balance OPA-20261026-005 (SA00875) — Hot Game
--   Stock adjustment:   Stock adjustment ADJ-20261026-001
-- Run this in each instance's Supabase SQL editor. Idempotent — safe to
-- re-run; already-rewritten rows are skipped. Entries without an
-- entry_number (created before migrations/add_journal_entry_number.sql ran)
-- keep their old text, since there is no reference to echo. Payroll (PAY)
-- and all other entry types are untouched. Not folded into full_schema.sql:
-- this is a data backfill, not schema.

-- 1) Supplier payments (SPP): the supplier name is the part of the linked
--    transaction's description before the first ' · ' separator
--    ('{Supplier} · PO-XXXXXXXX #SPP-xxxxxxxx').
UPDATE journal_entries je
SET description = 'Payment '
    || regexp_replace(je.entry_number, '^JE-\d+-', '')
    || ' — '
    || COALESCE(NULLIF(trim(split_part(t.description, ' · ', 1)), ''), 'Supplier')
FROM transactions t
WHERE je.reference_id = 'TX-' || t.id::text
  AND je.entry_number ~ '^JE-\d+-SPP-'
  AND t.description LIKE '%#SPP-%'
  AND je.description NOT LIKE 'Payment %';

-- 2) Opening AP balances (OPA): invoice number and supplier come from the
--    purchase order the entry references ('PO-<id>').
UPDATE journal_entries je
SET description = 'Opening AP balance '
    || regexp_replace(je.entry_number, '^JE-\d+-', '')
    || ' (' || COALESCE(NULLIF(trim(po.invoice_number), ''), 'NO-INV') || ')'
    || ' — ' || COALESCE(s.name, 'Supplier')
FROM purchase_orders po
LEFT JOIN suppliers s ON s.id = po.supplier_id
WHERE je.reference_id = 'PO-' || po.id::text
  AND je.entry_number ~ '^JE-\d+-OPA-'
  AND je.description NOT LIKE 'Opening AP balance %';

-- 3) Stock adjustments (ADJ): type label + reference only. The old text
--    ('Stock adjustment · {reason} · {notes}') also starts with 'Stock
--    adjustment', so idempotency is guarded on the reference prefix. The
--    reason/notes stay on the stock_adjustments row itself.
UPDATE journal_entries
SET description = 'Stock adjustment ' || regexp_replace(entry_number, '^JE-\d+-', '')
WHERE entry_number ~ '^JE-\d+-ADJ-'
  AND description NOT LIKE 'Stock adjustment ADJ-%';
