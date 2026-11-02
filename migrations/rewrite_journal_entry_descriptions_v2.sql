-- One-time DATA fix (no schema change): rewrite existing journal entry
-- descriptions into the unified area format new entries now get:
--   '{Area} - {REF} — {Name}'
--   Purchase  - SPP-20261024-001 — HOT GAME        (supplier payments)
--   Purchase  - GRN-20260912-001 — HOT GAME        (stock received; legacy PUR too)
--   Purchase  - OPA-20261026-005 — Hot Game (SA00875)  (AP opening balances)
--   Wholesale - WSP-20261024-002 — Meng Sethy      (receipts and COGS entries)
--   Retail    - RCP-20261024-003 — Sok Dara        (receipts; DEP deposits, DLV fees)
-- Run this in each instance's Supabase SQL editor AFTER the app update that
-- writes this format for new entries. Idempotent — safe to re-run; rows
-- already in the new format are skipped (guarded on '% — %'). Entries
-- without an entry_number (created before migrations/add_journal_entry_number.sql)
-- keep their old text, since there is no reference to echo. ADJ, MAN, PAY,
-- REV and EXP entries are untouched. Supersedes
-- rewrite_journal_entry_descriptions.sql (running that one afterwards is
-- harmless: its guards skip rows this one rewrote). Not folded into
-- full_schema.sql: this is a data backfill, not schema.

-- 1) Supplier payments (SPP): the supplier is the part of the linked
--    transaction's description before the first ' · ' separator
--    ('{Supplier} · PO-XXXXXXXX #SPP-xxxxxxxx').
UPDATE journal_entries je
SET description = 'Purchase - '
    || regexp_replace(je.entry_number, '^JE-\d+-', '')
    || ' — '
    || COALESCE(NULLIF(trim(split_part(t.description, ' · ', 1)), ''), 'Supplier')
FROM transactions t
WHERE je.reference_id = 'TX-' || t.id::text
  AND je.entry_number ~ '^JE-\d+-SPP-'
  AND t.description LIKE '%#SPP-%'
  AND je.description NOT LIKE '% — %';

-- 2) Stock received (GRN, and legacy PUR): supplier via the referenced
--    purchase order.
UPDATE journal_entries je
SET description = 'Purchase - '
    || regexp_replace(je.entry_number, '^JE-\d+-', '')
    || ' — ' || COALESCE(s.name, 'Supplier')
FROM purchase_orders po
LEFT JOIN suppliers s ON s.id = po.supplier_id
WHERE je.reference_id = 'PO-' || po.id::text
  AND je.entry_number ~ '^JE-\d+-(GRN|PUR)-'
  AND je.description NOT LIKE '% — %';

-- 3) AP opening balances (OPA): supplier and invoice via the referenced
--    purchase order; the invoice trails the name in parentheses.
UPDATE journal_entries je
SET description = 'Purchase - '
    || regexp_replace(je.entry_number, '^JE-\d+-', '')
    || ' — ' || COALESCE(s.name, 'Supplier')
    || ' (' || COALESCE(NULLIF(trim(po.invoice_number), ''), 'NO-INV') || ')'
FROM purchase_orders po
LEFT JOIN suppliers s ON s.id = po.supplier_id
WHERE je.reference_id = 'PO-' || po.id::text
  AND je.entry_number ~ '^JE-\d+-OPA-'
  AND je.description NOT LIKE '% — %';

-- 4) Wholesale receipts (WSP on a TX- reference): the customer is the part
--    of the linked transaction's description before the first ' · '
--    ('{Customer} · {INV} #WSP-xxxxxxxx').
UPDATE journal_entries je
SET description = 'Wholesale - '
    || regexp_replace(je.entry_number, '^JE-\d+-', '')
    || ' — '
    || COALESCE(NULLIF(trim(split_part(t.description, ' · ', 1)), ''), 'Wholesale')
FROM transactions t
WHERE je.reference_id = 'TX-' || t.id::text
  AND je.entry_number ~ '^JE-\d+-WSP-'
  AND t.description LIKE '%#WSP-%'
  AND je.description NOT LIKE '% — %';

-- 5) Wholesale COGS entries (WSP on a WSO-…-COGS reference): customer via
--    the referenced wholesale order; ' · COGS' marks the cost side apart
--    from the same-typed revenue receipts.
UPDATE journal_entries je
SET description = 'Wholesale - '
    || regexp_replace(je.entry_number, '^JE-\d+-', '')
    || ' — ' || COALESCE(NULLIF(trim(wo.customer_name), ''), 'Wholesale') || ' · COGS'
FROM wholesale_orders wo
WHERE je.reference_id = 'WSO-' || wo.id::text || '-COGS'
  AND je.entry_number ~ '^JE-\d+-WSP-'
  AND je.description NOT LIKE '% — %';

-- 6) Retail receipts, deposits and delivery fees (RCP/DEP/DLV on a TX-
--    reference): the linked transaction's description IS the customer name.
UPDATE journal_entries je
SET description = 'Retail - '
    || regexp_replace(je.entry_number, '^JE-\d+-', '')
    || ' — '
    || COALESCE(NULLIF(trim(t.description), ''), 'Customer')
FROM transactions t
WHERE je.reference_id = 'TX-' || t.id::text
  AND je.entry_number ~ '^JE-\d+-(RCP|DEP|DLV)-'
  AND je.description NOT LIKE '% — %';

-- 7) Retail COGS-only entries (RCP on an ORD-…-COGS reference): the old text
--    is '{Customer} · cost of goods sold' — keep the name, shorten the tag.
UPDATE journal_entries
SET description = 'Retail - '
    || regexp_replace(entry_number, '^JE-\d+-', '')
    || ' — '
    || COALESCE(NULLIF(trim(regexp_replace(description, ' · cost of goods sold$', '')), ''), 'Customer')
    || ' · COGS'
WHERE reference_id LIKE 'ORD-%-COGS'
  AND entry_number ~ '^JE-\d+-(RCP|DEP)-'
  AND description NOT LIKE '% — %';

-- 8) Entries rewritten by the first revision of this migration used ' -- '
--    as the name separator; the format settled on an em dash. Plain text
--    swap, scoped to numbered entries so user-written text is never touched.
UPDATE journal_entries
SET description = replace(description, ' -- ', ' — ')
WHERE entry_number IS NOT NULL
  AND description LIKE '% -- %';
