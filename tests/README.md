# Tests

Hand-rolled checks for the pieces that guard money and logins. No test
runner — each file is a plain Node script that prints PASS/FAIL lines and
exits non-zero on any failure.

## auth-guards.test.mjs

Runs `migrations/add_auth_guards.sql` (after its prerequisite
`migrations/applied/secure_pin_check.sql`) against an in-memory Postgres
(PGlite) and checks PIN matching parity, token mint/verify/revoke/rotation
and the column privileges, including that the `anon` role can neither read,
update nor insert `users.session_tokens`.

PGlite is not a dependency of the app, so install it without touching
package.json first:

    npm i --no-save @electric-sql/pglite
    node tests/auth-guards.test.mjs

(Or point at an existing copy: set `PGLITE_DIST` to a `file:///` URL of
`@electric-sql/pglite/dist/index.js`.)

## config-functions.test.mjs

Runs `migrations/add_config_functions.sql` against PGlite and checks the
per-key config merge (`update_app_config`): set/merge/unsetKeys/remove,
append/prepend/removeItems/updateItems with idKey + phone normalization,
the APP-1 scenario (two stale terminals, both edits survive), malformed
input, and op-for-op parity with the JS mirror
`src/utils/configOps.ts` (transpiled with the repo's esbuild). A SEC-1
addendum then layers `add_auth_guards.sql` + `add_session_guards.sql` on
top and proves the same merge semantics survive behind the guarded
`update_app_config(p_ops, p_session)` wrapper (the full guard matrix lives
in sec1-session-guards.test.mjs). Same PGlite
setup as auth-guards:

    npm i --no-save @electric-sql/pglite
    node tests/config-functions.test.mjs

## backup-restore.test.mjs

PGlite round-trip of the restore helpers (`src/utils/backupRestore.ts`):
chart_of_accounts is seeded with different random UUIDs in every database, so
journal_entry_lines from a backup must have `account_id` remapped by
`account_code` (custom accounts inserted), and columns the target lacks
(schema drift, e.g. `journal_entry_lines.description`) stripped and retried.
Builds two independent PGlite databases and proves the raw insert fails the FK
while the remapped restore lands every line on the right account. Also checks
the backup table list (`BACKUP_TABLES`): inventory_items (the FIFO layers) is
included, after products and sales. Same PGlite setup as auth-guards:

    npm i --no-save @electric-sql/pglite
    node tests/backup-restore.test.mjs

## order-status-rules.test.mjs

Unit test of `src/utils/orderStatusRules.ts` — the shared refusal rules the
Orders/OM2/Payment Tracking bulk edits, the OM2 drawer and Delivery
Tracking's badge enforce. Transpiled on the fly with the repo's own esbuild:

    node tests/order-status-rules.test.mjs

## sec1-session-guards.test.mjs

Runs `migrations/add_session_guards.sql` (SEC-1 phase 1) on top of the real
stack — `full_schema.sql`, `add_auth_guards.sql` and the five function packs
— and checks the session guard itself (null / invalid / wrong-permission /
valid sessions, with enforcement off and on), the per-function permission
map, the users-table rules (`save_user` / `delete_user` / `set_user_pin` /
`update_user_work_fields`), the app_config per-key permission map (the
roles rules included), that the old unguarded public signatures are gone,
that the `anon` role can no longer write `users` / `app_config` /
`security_settings` directly, and that the packs still work end to end with
sessions supplied. Same PGlite setup as auth-guards:

    npm i --no-save @electric-sql/pglite
    node tests/sec1-session-guards.test.mjs

## fifo-primitives.test.mjs

Runs `migrations/add_fifo_costing.sql` (FIFO phase 1) on top of the same
real stack as sec1-session-guards — `full_schema.sql`, `add_auth_guards.sql`,
the packs and `add_session_guards.sql` — after turning `inventory_items`
back into the live pre-FIFO table. Checks the migration (received_at
backfilled from created_at and kept on a re-run, the old status CHECK
widened to `written_off`, columns, indexes, runs twice with the guards
re-run after it), `fifo_fallback_cost` tiers, `fifo_add_layers`, and the
FIFO rules: `fifo_consume` takes layers by received_at then id; a partial
`fifo_return` gives back the newest first; a shortfall is costed at the last
receipt cost with no phantom rows, and a later return gives the short units
back first at the cost charged; return then consume picks the same rows;
written_off rows never return. Then `fifo_peek_cost` / `fifo_peek`,
`order_cogs` (frozen cost, else one peek per product),
`fifo_inventory_valuation`, `fifo_inventory_check` (variance 0, the
settled-before-ship term, a booked-vs-actual gap and a pool/stock mismatch
showing up), the guarded public read RPCs (permissions, enforcement, the
"run add_fifo_costing.sql" answer when the implementation is missing), and
that the wired ship path (phase 3) takes a layer and freezes its cost on the
line and the movement, and Add Stock sets purchase_cost. Since phase 3 the
packs refuse to load without `add_fifo_costing.sql`, so every DB test here
(sec1-session-guards included) runs it before the packs.
Same PGlite setup as auth-guards:

    npm i --no-save @electric-sql/pglite
    node tests/fifo-primitives.test.mjs

## fifo-rebuild-dryrun.test.mjs

Unit test of `planStore` in `src/scripts/fifo-rebuild-dryrun.cjs`, the
read-only plan of the one-time FIFO pool rebuild. Synthetic data, no
database: pool larger / smaller than stock, no rows (filler layers at the
last receipt cost, else purchase_cost), cost-0 rows re-costed to the newest
priced row, sold rows on Pending/ReStock orders and null sale_id written off,
settled / COGS-booked rows kept as history, unsettled shipped lines taking
the next-newest layers (oldest-shipped line first, fractional qty costed as
shortfall), the D1 guard failing on a basis mismatch and passing with a
`--basis` override, COGS booked for orders whose goods are still on hand
(SU) taken off the expected 1300 (holding, ~0 and line-less orders left
out), the orders left out of U listed by id, and pool count = stock
afterwards. Needs nothing extra:

    node tests/fifo-rebuild-dryrun.test.mjs

## fifo-rebuild.test.mjs

Runs `migrations/fifo_rebuild_pool.sql` (FIFO phase 2, the one-time pool
rebuild) on top of the same real stack as fifo-primitives, plus
`add_fifo_costing.sql`. One seeded store carries every drift case: pool
larger / smaller than stock, no rows (fillers at the newest priced restock,
which beats a received PO line, else purchase_cost), cost-0 / NULL rows
re-costed, sold rows on Pending / ReStock orders, null sale_id and
`returned` rows written off with sale_id cleared, settled and COGS-booked
(ORD-…-COGS or TX- with a 5000 line) history kept and stamped to its line,
unsettled shipped lines taking the next-newest layers oldest-shipped first
(a fractional part as cogs_short_qty), Returned and pre-cutoff orders, an
inactive product, a fractional stock, open / cancelled wholesale
orders backfilled at their booked COGS, and orders whose COGS is booked
while their goods are on hand (SU: recorded as cogs_booked, split like
os_spread_booked; a net-0 order and a deleted one left out). Each case is asserted, and the SQL
result is compared with the dry run (`buildInput` + `planStore` from
`src/scripts/fifo-rebuild-dryrun.cjs`) on the same rows: totals, V / B /
D1 / SU / guard, the SU orders, the orders left out of U, every row, every
filler and every line, with the default options and
with the Romdoul1 true-up options. Then pool count = stock, the Draft
FIFO-REVAL entry (app numbering, direction by sign), `fifo_inventory_check`
after the rebuild, the phase 1 primitives on the rebuilt pool, the D1 guard
(raises with the numbers, $1.00 passes, $1.01 does not, nothing changed),
the refusals (run once, phase 1 missing, bad basis / status / preset,
lines already costed or booked) and the file as shipped: with no preset
picked it refuses and changes nothing; with one picked it commits and its
last statement returns the summary rows, also kept in
public.fifo_rebuild_log. Same PGlite
setup as auth-guards:

    npm i --no-save @electric-sql/pglite
    node tests/fifo-rebuild.test.mjs

## fifo-orders.test.mjs, fifo-wholesale.test.mjs, fifo-adjustment.test.mjs

FIFO phase 3: every stock path and COGS wired to the FIFO layers. Each
builds the real stack in deploy order with `tests/fifo-test-db.mjs` (a
shared helper, not a test: `full_schema.sql`, auth guards,
`add_fifo_costing.sql`, the four packs, `add_session_guards.sql`), calls the
guarded public functions, and after every step asserts
`fifo_inventory_check`: variance 0 (1300 = pool + shipped-unbooked -
booked-unshipped + shipped-minus-booked) and pool count = products.stock.
The two cases that leave a known variance (an oversold shortfall line, a
pre-FIFO order restocked with no rows) assert that exact amount.

- fifo-orders: ship takes the oldest layers per line and freezes the cost
  (line and movement); ship then settle books the layer cost, not
  purchase_cost, and records cogs_booked; unship returns the exact rows and a
  re-ship takes the same ones with no adjustment; settle before ship books a
  peek and the later ship posts the Draft ORD-<id>-COGS-ADJ difference;
  leaving Paid drops the Draft receipt with its ADJ; a deposit-covered
  ORD-<id>-COGS is at FIFO; restock with a Draft receipt reverses nothing,
  with a Posted one posts a Draft ORD-<id>-COGS-REV; edit_order_items on a
  shipped settled order (ADJ for the difference) and on an unshipped one
  (booked COGS carried); delete_retail_orders gives rows back and reverses
  COGS left in a Posted entry; shortfall units and a pre-FIFO line come
  back as RET- layers; a pre-FIFO settled order leaving Paid is adopted at
  its row cost (the check moves by purchase cost minus row cost); deleting
  a restocked order keeps the Posted receipt's COGS reversed (the Draft REV
  is re-booked, also after it was moved back to Shipped) while a
  deposit-covered one (Draft ORD-COGS + Draft REV) nets to nothing; a no-product line added by an edit gets no booked COGS
  and no ADJ; an edit that leaves only no-product lines on a shipped settled
  order reverses its booked COGS with a Draft REV (leaving Paid then drops
  the Draft receipt with it; a delete with a Posted receipt re-books it);
  editing a pre-FIFO settled shipped order keeps the check
  (price-only: no ADJ; quantity: an ADJ for the extra unit); an un-shipped
  oversold line keeps its shortfall variance; a settled unshipped order
  edited to no product line and back gets its booked COGS back (a Draft
  REV is deleted, a Posted one offset by a Draft ADJ) and ships booked;
  leaving Paid with a Posted REV books a Draft ADJ so 5000 nets 0 for the
  order; the packs refuse to load
  without add_fifo_costing.sql or before the rebuild.
- fifo-wholesale: create / edit / cancel / delete with Draft vs Posted COGS
  (re-booked in place, WSO-<id>-COGS-ADJ-<n>, WSO-<id>-COGS-REV), the same
  rows taken again on an edit, an order backfilled by the rebuild (short
  units come back as layers at the booked cost), Add Stock and PO receipts
  (layers at the receipt cost, RST- / PO- refs, purchase_cost updated).
- fifo-adjustment: a removal writes off the oldest layers and the ADJ entry
  equals their cost (line unit_cost = their average); an addition creates
  layers at its cost on the adjustment date (the last receipt cost when it
  has none); a mixed adjustment books the net; an over-removal is refused
  with nothing moved. set_product_stock (the Inventory page's stock edits):
  up, down (Loss/Damage) and to zero each post a one-line adjustment whose
  ADJ entry equals the layers moved, with the movement, note, user and local
  date; the same figure creates nothing; bad input is refused with nothing
  changed. Every step keeps the FIFO check at variance 0.

Same PGlite setup as auth-guards:

    npm i --no-save @electric-sql/pglite
    node tests/fifo-orders.test.mjs
    node tests/fifo-wholesale.test.mjs
    node tests/fifo-adjustment.test.mjs
