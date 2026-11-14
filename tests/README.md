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

## currency-utils.test.mjs

Unit test of `src/utils/currency.ts` (riel payments: riel to USD rounded to
cents, the 4,100 default shop rate, the wrong-amount warnings — the
Romdoul2 $2 delivery fee typed as 8000 warns "៛8,000 = $1.95" — the list
line "៛82,000 @ 4,100 = $20.00", the $0.03 snap to a fixed USD amount, the
missing-column test the app's fallbacks use) and the currency rule of
`src/utils/cashBankAccounts.ts`: on the Romdoul1 and Romdoul2/3 charts every
USD pick and every payment-modal default is the same with and without the
riel accounts 1002/1011, a riel pick needs `currency: 'KHR'`, and a USD pick
never lands on a riel account. Transpiled on the fly with the repo's
esbuild:

    node tests/currency-utils.test.mjs

## khr-currency.test.mjs

Runs `migrations/add_khr_currency.sql` on the real stack
(`tests/fifo-test-db.mjs`) after turning it back into a live store as it is
today (no currency columns, no riel accounts, the pack's old
`wp_cash_bank_match`). Runs it twice and checks the 12 columns, one
`<table>_currency_check` each (EUR and KHR without an amount or rate
refused), the two accounts (an existing 1002 left alone), that the
automatic pick on a Romdoul2/3-like and a Romdoul1-like chart never lands
on a riel account while an exact riel name still resolves, that a PdFee
settled with no account debits 1000 Cash and not 1011, that the pack
carries the same exclusion, and that a bare store without `wp_internal`
loads the file. Same PGlite setup as auth-guards:

    npm i --no-save @electric-sql/pglite
    node tests/khr-currency.test.mjs

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
out), the orders left out of U listed by id, pool count = stock
afterwards, and E (basis-overridden products settled since the basis entry:
12 NR-3026 sales at 9.30 against a 9.00 basis give E 3.60, the guard passes
and the REVAL is D1 + E; a reversal, a re-costed re-settlement, an SU order
and an unexplained 1300 credit; E never takes more than the overridden
lines' cost difference: a duplicate entry, a mixed order whose other product
changed cost, a re-cost beyond purchase_cost and an unbooked order are not
absorbed, an adjustment counts at its unit_cost), an order a COGS-REV
reversed in full left out of SU and an ADJ netted into the booked amount,
and the Returned orders the basis entry still counted kept in U
(`returnedAfterBasis`: status at the cutoff from the order_status log, not
restocked, not settled or booked). Needs nothing extra:

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
the guard message naming the inactive product that still holds stock,
the backup table closed to the API roles (row level security, no grants),
the wholesale backfill marked cogs_backfill and reported apart from
shortfall (the mark cleared once a line gives its units back),
E (an NR-3026-style basis override with sales, a mixed order, a
reversal and re-settlement, an SU order, a stock adjustment and a wholesale
order booked at 9.30 after TRUEUP-20261112: guard 0, E = 0.30 a unit, the
FIFO-REVAL books D1 + E and the FIFO check variance is 0; an unexplained
1300 credit still fails; a missing or duplicated basis entry is refused),
the probes behind E's bounds (a mixed order whose other product's cost
changes after the sale, an order settled before the cutoff and reversed
after it — out of SU, -0.30 — one settled and reversed after it and back in
U, a re-cost from 9.00 to 9.30: guard 0 and FIFO check variance 0; a
duplicate COGS entry, a re-cost beyond purchase_cost and a write-off hidden
behind a cheaper product on a mixed order still fail), the Returned orders
the true-up still counted kept in U (status at the cutoff from the
order_status activity log; one Returned before it, one restocked and the
option without a basis entry left out or refused),
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
  deposit-covered one (its Draft ORD-COGS goes when the restock leaves Paid)
  nets to nothing; a no-product line added by an edit gets no booked COGS
  and no ADJ; an edit that leaves only no-product lines on a shipped settled
  order reverses its booked COGS with a Draft REV (leaving Paid then drops
  the Draft receipt with it; a delete with a Posted receipt re-books it);
  editing a pre-FIFO settled shipped order keeps the check
  (price-only: no ADJ; quantity: an ADJ for the extra unit); an un-shipped
  oversold line keeps its shortfall variance; a settled unshipped order
  edited to no product line and back gets its booked COGS back (a Draft
  REV is deleted, a Posted one offset by a Draft ADJ) and ships booked;
  leaving Paid with a Posted REV books a Draft ADJ so 5000 nets 0 for the
  order; a deposit-covered order restocked, shipped again and Paid again
  books its COGS again (Draft or Posted ORD-COGS), and a no-change edit then
  keeps it; leaving Paid on a deposit-covered order drops its Draft
  ORD-COGS (a Posted one gets a Draft REV); leaving Paid with a Posted
  receipt reverses its COGS with a Draft REV, so settling again books it
  once; a Posted receipt, an edit round trip and a second un-pay invent no
  ADJ; a Paid order with only a service line edited to products (receipt or
  deposit-covered, shipped or not) gets their COGS booked as an ADJ, and an
  Unpaid one does not; the packs refuse to load without
  add_fifo_costing.sql or before the rebuild is recorded in
  public.fifo_rebuild_log (a table named like the backup is not enough),
  and load with the backup dropped.
- fifo-wholesale: create / edit / cancel / delete with Draft vs Posted COGS
  (re-booked in place, WSO-<id>-COGS-ADJ-<n>, WSO-<id>-COGS-REV), the same
  rows taken again on an edit, an order backfilled by the rebuild (short
  units come back as layers at the booked cost), Add Stock and PO receipts
  (layers at the receipt cost, RST- / PO- refs, purchase_cost updated); a
  PO whose unit prices do not divide into cents (1000 x 0.125, two prices
  of one product) lays layers that add up to the line value and books the
  GRN at exactly that; a line with no product leaves the GRN at the stocked
  value with a notice naming the PO total.
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

## fifo-read-readiness.test.mjs

When the guarded FIFO read RPCs (order_cogs, fifo_peek,
fifo_inventory_valuation, fifo_inventory_check) answer: on a store that
re-ran add_session_guards.sql without add_fifo_costing.sql, and on one with
add_fifo_costing.sql and the guards but no rebuild (the packs refuse to
load), each answers "FIFO costing is not set up" with SQLSTATE 42883, and
`isFifoReadMissingError` (src/utils/supabaseErrors.ts, which the app's
retail settlement uses to keep its purchase_cost path) takes it as missing
while a network or session failure is not; once the rebuild is recorded
and the packs are loaded they answer. Bundles the TS helper with the
repo's esbuild. Same PGlite setup as auth-guards:

    npm i --no-save @electric-sql/pglite
    node tests/fifo-read-readiness.test.mjs

## The live column types (live-schema.mjs, live-schema-romdoul1.json)

The live stores were built by hand long before migrations/full_schema.sql,
and their columns differ from it: sale_items.quantity, products.stock,
purchase_order_items.quantity, stock_movements.quantity and
warehouse_stock.quantity are int4, sale_items.id and
warehouse_stock.warehouse_id are uuid, restocks.id is text, and several
columns are NOT NULL with no default (journal_entries.date,
purchase_orders.order_date, sales.total, products.price, ...). The first
FIFO go-live on Romdoul1 failed on exactly that (round(double precision,
integer) in fifo_rebuild_pool.sql), because every harness had run on
full_schema.sql's NUMERIC columns.

So every PGlite harness calls useLiveTypes(db) from tests/live-schema.mjs
after the schema and again after the migration stack: each column listed in
tests/live-schema-romdoul1.json is altered to the live type, nullability and
default (views around it are re-created), and the harness refuses to go on
if any shared column still differs. A test line label becomes the uuid
sale_items.id is live with lineUuid('S1-a'). The JSON is schema only (no
data). To refresh it, run the query in tests/live-schema-from-csv.mjs in the
store's SQL editor, save the result as CSV, then:

    node tests/live-schema-from-csv.mjs <export.csv> romdoul1

## fifo-golive-rehearsal.test.mjs

Part C of the owner runbook on a Romdoul1-shaped store on the live column
types: the pre-FIFO full_schema.sql and packs as last released (read from
git, commit e5ecec4, so the test needs the repo history), integer stock
(Test Product at 10, an inactive product at 0), shipped / delivered /
returned / paid orders with integer quantities, the Posted true-up
TRUEUP-20261112 and later Draft receipts at 9.30 for NR-3026 (basis 9.00),
wholesale orders, POs, stock movements and the status log. Then
add_fifo_costing.sql twice, the Test Product UPDATE, the dry run's plan of
the same data (guard 0), the whole fifo_rebuild_pool.sql with only its
PRESET line edited to romdoul1_trueup_2026_11_12 (the SQL summary must
equal the dry run), the four packs and add_session_guards.sql in the
runbook order, and day one: ship, settle, settle-before-ship, restock a
Returned order, edit a shipped order, Add Stock with a retry id, a
wholesale order out of a warehouse, a PO receipt and a warehouse stock
adjustment, each keeping fifo_inventory_check at variance 0 and layers =
stock. Same PGlite setup as auth-guards:

    npm i --no-save @electric-sql/pglite
    node tests/fifo-golive-rehearsal.test.mjs
