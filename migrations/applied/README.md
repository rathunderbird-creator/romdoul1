# Applied migrations (archive)

These per-feature migration files were consolidated into `../full_schema.sql`
on 2026-09-27 — that ONE file now creates the complete, current schema and is
safe to re-run anywhere (new instance or old).

Kept here for history and for their header comments (why each change was
made, ordering constraints, warnings). Two of them are one-time DATA fixes
that were deliberately NOT carried into full_schema.sql:

- `clear_settle_date_on_get_file.sql` — cleaned up Get File rows stamped by an old bug
- `rename_retail_income_category.sql` — renamed the retail income category

(`create_inventory_items.sql` also contained a one-time stock backfill block
that is not idempotent; only its CREATE TABLE went into full_schema.sql.)
