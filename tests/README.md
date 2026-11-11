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
`src/utils/configOps.ts` (transpiled with the repo's esbuild). Same PGlite
setup as auth-guards:

    npm i --no-save @electric-sql/pglite
    node tests/config-functions.test.mjs

## order-status-rules.test.mjs

Unit test of `src/utils/orderStatusRules.ts` — the shared refusal rules the
Orders/OM2/Payment Tracking bulk edits, the OM2 drawer and Delivery
Tracking's badge enforce. Transpiled on the fly with the repo's own esbuild:

    node tests/order-status-rules.test.mjs
